import { createHash, createPrivateKey, sign } from "node:crypto";
import { conjunto, contexto, emissorESerie, ia5, inteiro, nulo, octetos, oid, pemParaDer, seq } from "./der";

/**
 * Assinatura CMS destacada (CAdES) no padrão da ICP-Brasil para PDF:
 * política AD-RB do PAdES em vigor (PA_PAdES_AD_RB_v1_3, OID
 * 2.16.76.1.7.1.11.1.3, de 23/07/2025 a 22/10/2037), que exige os atributos
 * assinados content-type, message-digest, signing-certificate-v2 e
 * signature-policy-identifier, com SHA-256 e RSA de 2048 bits ou mais.
 *
 * No atributo vai o resumo declarado DENTRO da política (campo
 * signPolicyHash, o último do arquivo PA_PAdES_AD_RB_v1_3.der), que é o que o
 * Verificador de Conformidade do ITI confere. Não confundir com o hash do
 * arquivo inteiro publicado na LPA (23da544a…), que só serve para conferir
 * que o arquivo da política baixado é o oficial; com ele o ITI reprova
 * ("o resumo criptográfico da política está incorreto").
 */
export const POLITICA_AD_RB = {
  oid: "2.16.76.1.7.1.11.1.3",
  hashSha256: "23e4be4b9b362172e4ebb0e72b86a133ece5aad843d8651c6e38a0ba3f08fc60",
  uri: "http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_3.der",
} as const;

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sigPolicyId: "1.2.840.113549.1.9.16.2.15",
  spqUri: "1.2.840.113549.1.9.16.5.1",
  sha256: "2.16.840.1.101.3.4.2.1",
  sha256ComRsa: "1.2.840.113549.1.1.11",
} as const;

export interface Credencial {
  /** Chave privada (PEM). */
  chave: string;
  /** Certificado do titular primeiro, depois a cadeia (PEM). */
  certificados: string[];
}

export class ErroAssinatura extends Error {}

const atributo = (tipo: string, valor: Buffer) => seq(oid(tipo), conjunto(valor));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

/** Assina os bytes (as partes do PDF indicadas no ByteRange) e devolve o CMS em DER. */
export function assinarCms(conteudo: Buffer, credencial: Credencial): Buffer {
  const chave = createPrivateKey(credencial.chave);
  if (chave.asymmetricKeyType !== "rsa") throw new ErroAssinatura("O certificado precisa ter chave RSA (padrão da ICP-Brasil).");
  const bits = chave.asymmetricKeyDetails?.modulusLength ?? 0;
  if (bits < 2048) throw new ErroAssinatura("A chave do certificado é menor que 2048 bits, abaixo do exigido pela ICP-Brasil.");
  const [certificado, ...cadeia] = credencial.certificados.map(pemParaDer);
  if (!certificado) throw new ErroAssinatura("Certificado não encontrado.");
  const { emissor, serie } = emissorESerie(certificado);
  const algSha256 = seq(oid(OID.sha256));

  const atributos = [
    atributo(OID.contentType, oid(OID.data)),
    atributo(OID.messageDigest, octetos(sha256(conteudo))),
    // ESSCertIDv2 (hash SHA-256, o padrão, fica implícito) com emissor e série
    atributo(OID.signingCertificateV2, seq(seq(seq(octetos(sha256(certificado)), seq(seq(contexto(4, emissor)), serie))))),
    atributo(
      OID.sigPolicyId,
      seq(
        oid(POLITICA_AD_RB.oid),
        seq(algSha256, octetos(Buffer.from(POLITICA_AD_RB.hashSha256, "hex"))),
        seq(seq(oid(OID.spqUri), ia5(POLITICA_AD_RB.uri))),
      ),
    ),
  ];
  // A assinatura vale sobre o SET dos atributos em DER (marca 0x31); no
  // SignerInfo eles vão com a marca [0] implícita e o mesmo conteúdo.
  const assinados = conjunto(...atributos);
  const assinatura = sign("sha256", assinados, chave);
  const atributosImplicitos = Buffer.concat([Buffer.from([0xa0]), assinados.subarray(1)]);

  const signerInfo = seq(inteiro(1), seq(emissor, serie), algSha256, atributosImplicitos, seq(oid(OID.sha256ComRsa), nulo()), octetos(assinatura));
  const signedData = seq(
    inteiro(1),
    conjunto(algSha256),
    seq(oid(OID.data)),
    contexto(0, certificado, ...cadeia),
    conjunto(signerInfo),
  );
  return seq(oid(OID.signedData), contexto(0, signedData));
}
