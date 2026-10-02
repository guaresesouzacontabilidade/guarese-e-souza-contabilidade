import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { lerCertificadoA1, mesmaEmpresa, ErroCertificado } from "@/lib/notas-automaticas/certificado";
import { cifrar, decifrar, ErroChaveCertificados } from "@/lib/notas-automaticas/cripto";
import {
  eventoCienciaAssinado,
  lerResumoNfe,
  lerRetornoDistribuicao,
  lerRetornoEventos,
  montarDistribuicao,
  montarEnvioEventos,
  dataHoraBrasil,
} from "@/lib/notas-automaticas/nfe";
import { lerRetornoNfse, urlDistribuicaoNfse } from "@/lib/notas-automaticas/nfse";
import { requisitar } from "@/lib/notas-automaticas/transporte";

// -----------------------------------------------------------------------------
// Certificados de teste (gerados na hora; nada aqui é um certificado real)
// -----------------------------------------------------------------------------
interface ParChaves {
  chavePem: string;
  forgeChave: forge.pki.rsa.PrivateKey;
  forgePublica: forge.pki.rsa.PublicKey;
}

function novoPar(): ParChaves {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chavePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const forgeChave = forge.pki.privateKeyFromPem(chavePem) as forge.pki.rsa.PrivateKey;
  return { chavePem, forgeChave, forgePublica: forge.pki.setRsaPublicKey(forgeChave.n, forgeChave.e) };
}

function certificado(
  par: ParChaves,
  cn: string,
  opcoes: { emissor?: { par: ParChaves; cert: forge.pki.Certificate }; de?: Date; ate?: Date; ca?: boolean; dns?: string } = {},
) {
  const c = forge.pki.createCertificate();
  c.publicKey = par.forgePublica;
  c.serialNumber = "0" + randomBytes(8).toString("hex");
  c.validity.notBefore = opcoes.de ?? new Date(Date.now() - 86_400_000);
  c.validity.notAfter = opcoes.ate ?? new Date(Date.now() + 300 * 86_400_000);
  const sujeito = [{ name: "countryName", value: "BR" }, { name: "organizationName", value: "ICP-Brasil (TESTE)" }, { name: "commonName", value: cn }];
  c.setSubject(sujeito);
  c.setIssuer(opcoes.emissor ? opcoes.emissor.cert.subject.attributes : sujeito);
  const ext: object[] = [{ name: "basicConstraints", cA: Boolean(opcoes.ca) }];
  if (opcoes.dns) ext.push({ name: "subjectAltName", altNames: [{ type: 2, value: opcoes.dns }, { type: 7, ip: "127.0.0.1" }] });
  c.setExtensions(ext);
  c.sign(opcoes.emissor?.par.forgeChave ?? par.forgeChave, forge.md.sha256.create());
  return { forge: c, pem: forge.pki.certificateToPem(c) };
}

function pfx(par: ParChaves, certs: forge.pki.Certificate[], senha: string, algoritmo: "3des" | "aes256") {
  const asn1 = forge.pkcs12.toPkcs12Asn1(par.forgeChave, certs, senha, { algorithm: algoritmo });
  return new Uint8Array(Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"));
}

const CNPJ = "12345678000195";
let empresa: ParChaves;
let ac: ParChaves;
let certAc: ReturnType<typeof certificado>;
let certEmpresa: ReturnType<typeof certificado>;

beforeAll(() => {
  ac = novoPar();
  empresa = novoPar();
  certAc = certificado(ac, "AC TESTE", { ca: true });
  certEmpresa = certificado(empresa, `EMPRESA TESTE LTDA:${CNPJ}`, { emissor: { par: ac, cert: certAc.forge } });
});

describe("certificado A1", () => {
  it("abre o .pfx (3DES e AES), separa chave, certificado e cadeia e lê o CNPJ", () => {
    for (const alg of ["3des", "aes256"] as const) {
      const lido = lerCertificadoA1(pfx(empresa, [certEmpresa.forge, certAc.forge], "s3nh@", alg), "s3nh@");
      expect(lido.titular).toBe(`EMPRESA TESTE LTDA:${CNPJ}`);
      expect(lido.documento).toBe(CNPJ);
      expect(lido.emissor).toBe("AC TESTE");
      expect(lido.cadeiaPem).toHaveLength(1);
      expect(lido.impressaoDigital).toMatch(/^[0-9A-F]{64}$/);
      expect(lido.chavePem).toContain("BEGIN PRIVATE KEY");
    }
  });

  it("senha errada, certificado vencido e e-CPF são recusados ou sinalizados", () => {
    const arquivo = pfx(empresa, [certEmpresa.forge], "certa", "3des");
    expect(() => lerCertificadoA1(arquivo, "errada")).toThrow("Senha do certificado incorreta.");
    const vencido = certificado(empresa, `EMPRESA TESTE LTDA:${CNPJ}`, { de: new Date("2024-01-01"), ate: new Date("2025-01-01") });
    expect(() => lerCertificadoA1(pfx(empresa, [vencido.forge], "x", "3des"), "x")).toThrow(/venceu em/);
    const pf = certificado(empresa, "FULANO DE TAL:12345678909");
    expect(lerCertificadoA1(pfx(empresa, [pf.forge], "x", "3des"), "x").documento).toBeNull();
    expect(() => lerCertificadoA1(new Uint8Array([1, 2, 3]), "x")).toThrow(ErroCertificado);
  });

  it("confere a raiz do CNPJ da empresa (inclusive CNPJ alfanumérico)", () => {
    expect(mesmaEmpresa(CNPJ, "12.345.678/0002-76")).toBe(true);
    expect(mesmaEmpresa(CNPJ, "98.765.432/0001-10")).toBe(false);
    expect(mesmaEmpresa("12ABC34501DE35", "12.ABC.345/01DE-35")).toBe(true);
    expect(mesmaEmpresa(null, CNPJ)).toBe(false);
  });
});

describe("cifra dos certificados guardados", () => {
  it("cifra e decifra com a chave do servidor; alteração ou outra chave são detectadas", () => {
    const anterior = process.env.CERTIFICADOS_CHAVE;
    process.env.CERTIFICADOS_CHAVE = randomBytes(32).toString("base64");
    try {
      const c = cifrar("conteúdo secreto");
      expect(c).toMatch(/^v1:/);
      expect(c).not.toContain("secreto");
      expect(decifrar(c)).toBe("conteúdo secreto");
      const b = Buffer.from(c.slice(3), "base64");
      b[b.length - 1] ^= 1;
      expect(() => decifrar(`v1:${b.toString("base64")}`)).toThrow(ErroChaveCertificados);
      process.env.CERTIFICADOS_CHAVE = randomBytes(32).toString("base64");
      expect(() => decifrar(c)).toThrow(ErroChaveCertificados);
      delete process.env.CERTIFICADOS_CHAVE;
      expect(() => cifrar("x")).toThrow(/CERTIFICADOS_CHAVE/);
    } finally {
      process.env.CERTIFICADOS_CHAVE = anterior;
    }
  });
});

// -----------------------------------------------------------------------------
// NF-e: distribuição e ciência
// -----------------------------------------------------------------------------
const CHAVE = "17260912345678000195550010000012341000012347";

function docZip(xml: string) {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

describe("NF-e — distribuição de DF-e", () => {
  it("monta a consulta por NSU no layout 1.01", () => {
    const xml = montarDistribuicao({ cnpj: CNPJ, uf: "TO", ultNsu: "41", ambiente: "producao" });
    expect(xml).toContain('<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">');
    expect(xml).toContain("<tpAmb>1</tpAmb><cUFAutor>17</cUFAutor><CNPJ>12345678000195</CNPJ>");
    expect(xml).toContain("<distNSU><ultNSU>000000000000041</ultNSU></distNSU>");
    expect(() => montarDistribuicao({ cnpj: CNPJ, uf: "XX", ultNsu: "0", ambiente: "producao" })).toThrow(/UF/);
  });

  it("lê o retorno: situação, NSU e documentos compactados (resumo e XML completo)", () => {
    const resumo =
      `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>98765432000110</CNPJ>` +
      "<xNome>FORNECEDOR TESTE</xNome><IE>123</IE><dhEmi>2026-09-30T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1500.75</vNF>" +
      "<digVal>x</digVal><dhRecbto>2026-09-30T10:00:05-03:00</dhRecbto><nProt>117260000000001</nProt><cSitNFe>1</cSitNFe></resNFe>";
    const resposta =
      '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
      '<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>' +
      '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1.0</verAplic><cStat>138</cStat>' +
      "<xMotivo>Documento localizado</xMotivo><dhResp>2026-10-02T10:00:00-03:00</dhResp><ultNSU>000000000000043</ultNSU><maxNSU>000000000000050</maxNSU>" +
      `<loteDistDFeInt><docZip NSU="000000000000042" schema="resNFe_v1.01.xsd">${docZip(resumo)}</docZip>` +
      `<docZip NSU="000000000000043" schema="procNFe_v4.00.xsd">${docZip("<nfeProc/>")}</docZip></loteDistDFeInt>` +
      "</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>";
    const r = lerRetornoDistribuicao(resposta);
    expect(r).toMatchObject({ cStat: "138", ultNsu: "000000000000043", maxNsu: "000000000000050" });
    expect(r.documentos.map((d) => [d.nsu, d.tipo])).toEqual([
      ["000000000000042", "resNFe"],
      ["000000000000043", "procNFe"],
    ]);
    expect(lerResumoNfe(r.documentos[0].xml)).toMatchObject({
      chave: CHAVE,
      emitenteDocumento: "98765432000110",
      emitenteNome: "FORNECEDOR TESTE",
      valor: "1500.75",
      tipoNf: "1",
      situacao: "autorizada",
    });
    expect(lerRetornoDistribuicao(resposta.replace(/<loteDistDFeInt>.*<\/loteDistDFeInt>/, "").replace("138", "137")).documentos).toEqual([]);
    expect(() => lerRetornoDistribuicao("<html>erro</html>")).toThrow(/retDistDFeInt/);
  });
});

describe("NF-e — ciência da emissão assinada", () => {
  it("gera o evento 210210 com assinatura XML válida (conferida por verificador independente)", () => {
    const quando = new Date("2026-10-02T13:15:30Z");
    expect(dataHoraBrasil(quando)).toBe("2026-10-02T10:15:30-03:00");
    const evento = eventoCienciaAssinado({ chave: CHAVE, cnpj: CNPJ, ambiente: "producao", quando, chavePem: empresa.chavePem, certificadoPem: certEmpresa.pem });
    expect(evento).toContain(`<infEvento Id="ID210210${CHAVE}01">`);
    expect(evento).toContain("<cOrgao>91</cOrgao><tpAmb>1</tpAmb>");
    expect(evento).toContain("<descEvento>Ciencia da Operacao</descEvento>");

    // O evento vai dentro do lote (envEvento), como a SEFAZ recebe
    const lote = montarEnvioEventos([evento], "202610021015");
    const xml = /<envEvento[\s\S]*<\/envEvento>/.exec(lote)![0];
    const verificar = (conteudo: string) => {
      const doc = new DOMParser().parseFromString(conteudo, "text/xml");
      const sig = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];
      const v = new SignedXml({ publicCert: certEmpresa.pem });
      v.loadSignature(sig);
      try {
        return v.checkSignature(conteudo);
      } catch {
        return false;
      }
    };
    expect(verificar(xml)).toBe(true);
    // Qualquer alteração no evento invalida a assinatura
    expect(verificar(xml.replace("<nSeqEvento>1</nSeqEvento>", "<nSeqEvento>2</nSeqEvento>"))).toBe(false);
    expect(verificar(xml.replace("Ciencia da Operacao", "Confirmacao da Operacao"))).toBe(false);
  });

  it("lê o retorno do lote de eventos", () => {
    const resposta =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">' +
      '<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>1</tpAmb><verAplic>AN</verAplic><cOrgao>91</cOrgao>' +
      "<cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo>" +
      `<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><verAplic>AN</verAplic><cOrgao>91</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${CHAVE}</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><nProt>891260000000001</nProt></infEvento></retEvento>` +
      "</retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>";
    expect(lerRetornoEventos(resposta)).toEqual({
      cStat: "128",
      xMotivo: "Lote de evento processado",
      eventos: [{ chave: CHAVE, cStat: "135", xMotivo: "Evento registrado e vinculado a NF-e", protocolo: "891260000000001" }],
    });
  });
});

describe("NFS-e — Ambiente de Dados Nacional", () => {
  it("monta o endereço por NSU e lê o lote (XML compactado em base64)", () => {
    expect(urlDistribuicaoNfse(10, "producao")).toBe("https://adn.nfse.gov.br/contribuintes/DFe/10?lote=true");
    const r = lerRetornoNfse(
      JSON.stringify({
        StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
        LoteDFe: [
          { NSU: 11, ChaveAcesso: "1".repeat(50), TipoDocumento: "NFSE", ArquivoXml: docZip("<NFSe/>") },
          { nsu: 12, chaveAcesso: "2".repeat(50), tipoDocumento: "EVENTO", arquivoXml: Buffer.from("<evento/>").toString("base64") },
        ],
      }),
      200,
    );
    expect(r.situacao).toBe("documentos");
    expect(r.documentos.map((d) => [d.nsu, d.tipo, d.xml])).toEqual([
      [11, "NFSE", "<NFSe/>"],
      [12, "EVENTO", "<evento/>"],
    ]);
    expect(lerRetornoNfse(JSON.stringify({ StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO", LoteDFe: [] }), 404).situacao).toBe("nenhum");
    const erro = lerRetornoNfse(JSON.stringify({ StatusProcessamento: "REJEICAO", Erros: [{ Codigo: "E1", Descricao: "Certificado inválido" }] }), 400);
    expect(erro).toMatchObject({ situacao: "erro", mensagem: "E1: Certificado inválido" });
    expect(lerRetornoNfse("<html>", 502).situacao).toBe("erro");
    expect(lerRetornoNfse("", 204).situacao).toBe("nenhum");
    expect(lerRetornoNfse("", 403)).toMatchObject({ situacao: "erro", mensagem: expect.stringContaining("certificado da empresa não foi aceito") });
  });
});

// -----------------------------------------------------------------------------
// Conexão com certificado do cliente (TLS mútuo) contra um servidor local
// -----------------------------------------------------------------------------
describe("conexão segura com o certificado da empresa", () => {
  let servidor: https.Server;
  let url = "";
  let certServidor: ReturnType<typeof certificado>;

  beforeAll(async () => {
    const parServidor = novoPar();
    certServidor = certificado(parServidor, "localhost", { emissor: { par: ac, cert: certAc.forge }, dns: "localhost" });
    servidor = https.createServer(
      { key: parServidor.chavePem, cert: certServidor.pem, ca: [certAc.pem], requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        const cn = (req.socket as import("node:tls").TLSSocket).getPeerCertificate().subject?.CN;
        let corpo = "";
        req.on("data", (b) => (corpo += b));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/soap+xml", "Content-Encoding": "gzip" });
          res.end(gzipSync(`ok:${cn}:${req.headers["content-type"]}:${corpo.length}`));
        });
      },
    );
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    url = `https://localhost:${(servidor.address() as AddressInfo).port}/servico`;
  });
  afterAll(() => servidor.close());

  it("apresenta o certificado da empresa e lê a resposta compactada", async () => {
    const r = await requisitar(url, {
      metodo: "POST",
      credencial: { chave: empresa.chavePem, certificados: [certEmpresa.pem, certAc.pem] },
      corpo: "<x/>",
      cabecalhos: { "Content-Type": "application/soap+xml; charset=utf-8" },
      ca: [certAc.pem],
    });
    expect(r.status).toBe(200);
    expect(r.corpo).toBe(`ok:EMPRESA TESTE LTDA:${CNPJ}:application/soap+xml; charset=utf-8:4`);
  });

  it("sem certificado aceito pelo servidor, a conexão é recusada (sem ignorar a verificação)", async () => {
    const outro = novoPar();
    const autoassinado = certificado(outro, "OUTRA EMPRESA:98765432000110");
    await expect(
      requisitar(url, { metodo: "GET", credencial: { chave: outro.chavePem, certificados: [autoassinado.pem] }, ca: [certAc.pem], tempoLimiteMs: 5000 }),
    ).rejects.toThrow();
    // E o certificado do servidor precisa ser confiável: sem a AC de teste, a conexão falha
    await expect(
      requisitar(url, { metodo: "GET", credencial: { chave: empresa.chavePem, certificados: [certEmpresa.pem] }, tempoLimiteMs: 5000 }),
    ).rejects.toThrow();
  });
});
