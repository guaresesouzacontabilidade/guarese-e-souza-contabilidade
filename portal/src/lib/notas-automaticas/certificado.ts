import "server-only";
import forge from "node-forge";
import { X509Certificate, createPrivateKey } from "node:crypto";

/**
 * Leitura do certificado digital A1 (arquivo .pfx/.p12) no cadastro.
 *
 * O node-forge abre o arquivo (inclusive os formatos antigos, com RC2 e 3DES,
 * que o OpenSSL 3 do Node não abre sem o modo legado). Ele é usado só aqui,
 * para decifrar o arquivo com a senha informada; a verificação de assinaturas
 * RSA do node-forge (alvo do alerta GHSA-86w9-cpqp-85rv) não é usada. Depois
 * da leitura, a senha é descartada: o portal guarda a chave privada e o
 * certificado (cifrados) e usa as funções nativas do Node para a conexão
 * segura com a SEFAZ e para assinar eventos.
 */

export interface CertificadoLido {
  chavePem: string;
  certificadoPem: string;
  cadeiaPem: string[];
  titular: string;
  documento: string | null;
  emissor: string;
  numeroSerie: string;
  impressaoDigital: string;
  validoDe: Date;
  validoAte: Date;
}

export class ErroCertificado extends Error {}

export const TAMANHO_MAXIMO_CERTIFICADO = 64 * 1024;

/** OID do CNPJ no certificado ICP-Brasil (otherName 2.16.76.1.3.3). */
const OID_CNPJ = Buffer.from([0x06, 0x05, 0x60, 0x4c, 0x01, 0x03, 0x03]);

function campo(nome: string, dn: string): string | null {
  const m = new RegExp(`(?:^|\\n)${nome}=([^\\n]+)`).exec(dn);
  return m ? m[1].trim() : null;
}

/** CNPJ do titular: no nome ("RAZAO SOCIAL:12345678000195") ou no campo próprio da ICP-Brasil. */
export function cnpjDoCertificado(cn: string | null, der: Buffer): string | null {
  const doNome = cn ? /:([0-9A-Z]{12}[0-9]{2})$/.exec(cn.toUpperCase())?.[1] : null;
  if (doNome) return doNome;
  const i = der.indexOf(OID_CNPJ);
  if (i < 0) return null;
  const trecho = der.subarray(i + OID_CNPJ.length, i + OID_CNPJ.length + 24).toString("latin1");
  return /([0-9A-Z]{12}[0-9]{2})/.exec(trecho)?.[1] ?? null;
}

export function lerCertificadoA1(arquivo: Uint8Array, senha: string, agora = new Date()): CertificadoLido {
  if (arquivo.length === 0 || arquivo.length > TAMANHO_MAXIMO_CERTIFICADO) {
    throw new ErroCertificado("Arquivo de certificado inválido (o A1 tem poucos kilobytes, extensão .pfx ou .p12).");
  }
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(arquivo).toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/mac could not be verified|invalid password/i.test(msg)) throw new ErroCertificado("Senha do certificado incorreta.");
    throw new ErroCertificado("Não foi possível abrir o arquivo. Confira se é o certificado A1 (.pfx ou .p12) e a senha.");
  }

  const bags = (tipo: string) => p12.getBags({ bagType: tipo })[tipo] ?? [];
  const chaves = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)].map((b) => b.key).filter(Boolean) as forge.pki.rsa.PrivateKey[];
  const certificados = bags(forge.pki.oids.certBag)
    .map((b) => b.cert)
    .filter(Boolean) as forge.pki.Certificate[];
  if (!chaves.length) throw new ErroCertificado("O arquivo não tem a chave privada (exporte o certificado com a chave).");
  if (!certificados.length) throw new ErroCertificado("O arquivo não tem o certificado.");

  // Certificado da empresa: o que corresponde à chave privada; os demais formam a cadeia
  let chave: forge.pki.rsa.PrivateKey | null = null;
  let folha: forge.pki.Certificate | null = null;
  for (const k of chaves) {
    const c = certificados.find((x) => {
      const pub = x.publicKey as forge.pki.rsa.PublicKey;
      return Boolean(pub?.n && k.n && pub.n.equals(k.n) && pub.e.equals(k.e));
    });
    if (c) {
      chave = k;
      folha = c;
      break;
    }
  }
  if (!chave || !folha) throw new ErroCertificado("A chave privada não corresponde a nenhum certificado do arquivo.");

  const chavePem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave)));
  const certificadoPem = forge.pki.certificateToPem(folha);
  const cadeiaPem = certificados.filter((c) => c !== folha).map((c) => forge.pki.certificateToPem(c));
  // Conferência com as funções nativas (as que serão usadas na conexão)
  try {
    createPrivateKey(chavePem);
  } catch {
    throw new ErroCertificado("Tipo de chave privada não suportado.");
  }
  const x509 = new X509Certificate(certificadoPem);
  const validoDe = new Date(x509.validFrom);
  const validoAte = new Date(x509.validTo);
  if (validoAte <= agora) throw new ErroCertificado(`Este certificado venceu em ${validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Araguaina" })}.`);
  if (validoDe.getTime() > agora.getTime() + 86_400_000) throw new ErroCertificado("Este certificado ainda não está válido.");
  const titular = campo("CN", x509.subject) ?? x509.subject.replace(/\n/g, ", ");
  return {
    chavePem,
    certificadoPem,
    cadeiaPem,
    titular,
    documento: cnpjDoCertificado(titular, x509.raw),
    emissor: campo("CN", x509.issuer) ?? x509.issuer.replace(/\n/g, ", "),
    numeroSerie: x509.serialNumber.toUpperCase().replace(/^0+(?=.)/, ""),
    impressaoDigital: x509.fingerprint256.replace(/:/g, "").toUpperCase(),
    validoDe,
    validoAte,
  };
}

/** Mesmo CNPJ (raiz de 8 caracteres) da empresa. */
export function mesmaEmpresa(documentoCertificado: string | null, documentoEmpresa: string | null | undefined): boolean {
  const a = (documentoCertificado ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const b = (documentoEmpresa ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return a.length === 14 && b.length === 14 && a.slice(0, 8) === b.slice(0, 8);
}
