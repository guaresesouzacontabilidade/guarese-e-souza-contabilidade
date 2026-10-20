import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { dpsAssinada, idDps, montarInfDps, pedidoCancelamentoAssinado, textoLeiaute, type DadosDps } from "@/lib/nfse-emissao/dps";
import { esquemasNt009 } from "./apoio/xsd-nt009";

/**
 * DPS da NFS-e (leiaute 1.01): o XML gerado passa nos esquemas oficiais
 * (tests/fixtures/nfse-xsd-1.01, publicados em gov.br/nfse) e a assinatura
 * confere. Dados fictícios.
 */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const chavePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const k = forge.pki.privateKeyFromPem(chavePem) as forge.pki.rsa.PrivateKey;
const c = forge.pki.createCertificate();
c.publicKey = forge.pki.setRsaPublicKey(k.n, k.e);
c.serialNumber = "01" + randomBytes(6).toString("hex");
c.validity.notBefore = new Date(Date.now() - 86_400_000);
c.validity.notAfter = new Date(Date.now() + 86_400_000);
c.setSubject([{ name: "commonName", value: "EMPRESA FICTICIA LTDA:11444777000161" }]);
c.setIssuer([{ name: "commonName", value: "EMPRESA FICTICIA LTDA:11444777000161" }]);
c.sign(k, forge.md.sha256.create());
const certificadoPem = forge.pki.certificateToPem(c);
const chaves = { chavePem, certificadoPem };

/**
 * Cópia dos esquemas para o xmllint: o padrão da série ("^0{0,4}\d{1,5}$")
 * usa ^ e $ como âncoras (como no .NET da Sefin), mas no XML Schema eles são
 * caracteres comuns. Na cópia, as âncoras saem (os padrões do XSD já valem
 * para o valor inteiro).
 */
const XSD = (() => {
  const pasta = mkdtempSync(join(tmpdir(), "nfse-xsd-"));
  cpSync(resolve("tests/fixtures/nfse-xsd-1.01"), pasta, { recursive: true });
  const tipos = join(pasta, "tiposSimples_v1.01.xsd");
  writeFileSync(tipos, readFileSync(tipos, "utf8").replace('pattern value="^0{0,4}\\d{1,5}$"', 'pattern value="0{0,4}\\d{1,5}"'));
  return pasta;
})();
const temXmllint = (() => {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const XSD_NT009 = esquemasNt009();

function validar(xml: string, esquema: string, pastaXsd = XSD) {
  const pasta = mkdtempSync(join(tmpdir(), "dps-"));
  const arquivo = join(pasta, "doc.xml");
  writeFileSync(arquivo, xml);
  try {
    execFileSync("xmllint", ["--noout", "--schema", join(pastaXsd, esquema), arquivo], { stdio: "pipe" });
    return "ok";
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

function assinaturaConfere(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const v = new SignedXml({ publicCert: certificadoPem });
  v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0] as unknown as Node);
  return v.checkSignature(xml);
}

const base: DadosDps = {
  ambiente: "homologacao",
  leiaute: "1.01",
  emitidaEm: new Date("2026-10-20T13:30:00Z"),
  serie: 1,
  numero: 42,
  competencia: "2026-10-20",
  codigoMunicipioEmissor: "1718204",
  prestador: { cnpj: "11444777000161", inscricaoMunicipal: null, opcaoSimples: 3, regimeApuracaoSn: 1, regimeEspecial: 0 },
  tomador: {
    tipo: "cnpj",
    documento: "12345678000195",
    nome: "Cliente Fictício & Filhos Ltda",
    endereco: { logradouro: "Avenida Murilo Braga", numero: "1000", complemento: null, bairro: "Centro", codigoMunicipio: "1718204", cep: "77500-000" },
    email: "financeiro@cliente.test",
    telefone: null,
  },
  servico: {
    localPrestacao: "1718204",
    codigoTributacaoNacional: "170101",
    codigoTributacaoMunicipal: null,
    codigoNbs: null,
    descricao: "Consultoria “empresarial” — outubro/2026\nReunião <mensal> 😀",
  },
  valor: "1500",
  issRetido: false,
  aliquotaIss: null,
  tributosAproximados: { tipo: "simples", percentual: "6" },
  informacoesComplementares: null,
};

describe("NFS-e: DPS no leiaute nacional", () => {
  it("identificador: município, tipo de inscrição, CNPJ, série e número", () => {
    expect(idDps("1718204", "11444777000161", 1, 42)).toBe("DPS171820421144477700016100001000000000000042");
    expect(idDps("1718204", "11444777000161", 1, 42)).toHaveLength(45);
  });

  it("texto dentro do que o leiaute aceita (Latin-1, sem emojis)", () => {
    expect(textoLeiaute("Serviço “A” – parte 1…  😀 ", 100)).toBe('Serviço "A" - parte 1...');
    expect(textoLeiaute("linha 1\r\nlinha 2\n\n\n\nlinha 3", 100, { quebras: true })).toBe("linha 1\nlinha 2\n\nlinha 3");
  });

  it("Simples ME/EPP com tomador CNPJ: sem nome/endereço do prestador, sem alíquota, tributos do SN; passa no XSD e a assinatura confere", () => {
    const { xml, id } = dpsAssinada(base, chaves);
    expect(id).toBe("DPS171820421144477700016100001000000000000042");
    expect(xml).toContain("<tpEmit>1</tpEmit>");
    expect(xml).toContain("<dhEmi>2026-10-20T10:30:00-03:00</dhEmi>");
    expect(xml).toContain("<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib>");
    expect(/<prest>.*?<\/prest>/.exec(xml)![0]).not.toContain("<xNome>");
    expect(xml).not.toContain("<pAliq>");
    expect(xml).toContain("<pTotTribSN>6.00</pTotTribSN>");
    expect(xml).toContain("<vServ>1500.00</vServ>");
    expect(xml).toContain("<xNome>Cliente Fictício &amp; Filhos Ltda</xNome>");
    expect(xml).toContain("<CEP>77500000</CEP>");
    expect(xml).toContain('Consultoria "empresarial" - outubro/2026\nReunião &lt;mensal&gt;</xDescServ>');
    if (temXmllint) expect(validar(xml, "DPS_v1.01.xsd")).toBe("ok");
    expect(assinaturaConfere(xml)).toBe(true);
  });

  it("Simples com ISS retido informa a alíquota; MEI sem tomador não informa tributos; não optante informa percentuais", () => {
    const retido = dpsAssinada({ ...base, issRetido: true, aliquotaIss: "2.5" }, chaves).xml;
    expect(retido).toContain("<tpRetISSQN>2</tpRetISSQN><pAliq>2.50</pAliq>");

    const mei = dpsAssinada(
      { ...base, prestador: { ...base.prestador, opcaoSimples: 2 }, tomador: null, tributosAproximados: { tipo: "nao_informar" } },
      chaves,
    ).xml;
    expect(mei).toContain("<regTrib><opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib></regTrib>");
    expect(mei).not.toContain("<toma>");
    expect(mei).toContain("<indTotTrib>0</indTotTrib>");

    const presumido = dpsAssinada(
      {
        ...base,
        prestador: { ...base.prestador, opcaoSimples: 1, inscricaoMunicipal: "12345" },
        tomador: { tipo: "cpf", documento: "52998224725", nome: "Fulano de Tal", endereco: null, email: null, telefone: "63999990000" },
        tributosAproximados: { tipo: "percentuais", federal: "13.45", estadual: "0", municipal: "5" },
        informacoesComplementares: "Pedido 123\nentregue",
      },
      chaves,
    ).xml;
    expect(presumido).toContain("<CNPJ>11444777000161</CNPJ><IM>12345</IM><regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib>");
    expect(presumido).toContain("<pTotTrib><pTotTribFed>13.45</pTotTribFed><pTotTribEst>0</pTotTribEst><pTotTribMun>5.00</pTotTribMun></pTotTrib>");
    expect(presumido).toContain("<infoCompl><xInfComp>Pedido 123 entregue</xInfComp></infoCompl>");
    for (const xml of [retido, mei, presumido]) {
      if (temXmllint) expect(validar(xml, "DPS_v1.01.xsd")).toBe("ok");
      expect(assinaturaConfere(xml)).toBe(true);
    }
  });

  it("dados fora do leiaute são recusados antes do envio", () => {
    expect(() => montarInfDps({ ...base, valor: "-1" })).toThrow();
    expect(() => montarInfDps({ ...base, issRetido: true, aliquotaIss: null })).toThrow(/alíquota/);
    const tomadorCnpj = base.tomador as Extract<DadosDps["tomador"], { tipo: "cnpj" }>;
    expect(() => montarInfDps({ ...base, tomador: { ...tomadorCnpj, endereco: { ...tomadorCnpj.endereco, cep: "123" } } })).toThrow(/CEP/);
  });

  it("pedido de cancelamento (evento 101101): identificador, esquema e assinatura", () => {
    const chave = "1718204211444777000161000000000004226104112345678";
    const { xml, id } = pedidoCancelamentoAssinado(
      { ambiente: "homologacao", chave: chave.padEnd(50, "0"), cnpj: "11444777000161", quando: base.emitidaEm, motivo: 1, justificativa: "Valor digitado errado na nota" },
      chaves,
    );
    expect(id).toBe(`PRE${chave.padEnd(50, "0")}101101`);
    expect(xml).toContain("<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Valor digitado errado na nota</xMotivo></e101101>");
    if (temXmllint) expect(validar(xml, "pedRegEvento_v1.01.xsd")).toBe("ok");
    expect(assinaturaConfere(xml)).toBe(true);
    expect(() =>
      pedidoCancelamentoAssinado({ ambiente: "homologacao", chave: chave.padEnd(50, "0"), cnpj: "11444777000161", quando: new Date(), motivo: 9, justificativa: "curta" }, chaves),
    ).toThrow(/15 caracteres/);
  });
});

describe("NFS-e autorizada: leitura e DANFSe", () => {
  it("nota no formato da Sefin (fictícia) é lida: chave, número e ambiente", async () => {
    const { nfseFicticia } = await import("./apoio/nfse-ficticia");
    const { lerNfse } = await import("@/lib/nfse-emissao/sefin");
    const { xml: dps } = dpsAssinada(base, chaves);
    const { xml, chave } = nfseFicticia(dps, { cnpj: "11444777000161", numero: 15, ambiente: 2, chaves });
    if (temXmllint) expect(validar(xml, "NFSe_v1.01.xsd")).toBe("ok");
    const lida = lerNfse(xml);
    expect(lida).toMatchObject({ chave, numero: "15", ambiente: "homologacao", processadaEm: "2026-10-20T10:30:05-03:00" });
    expect(lida.dps).not.toBeNull();
  });

  it("DANFSe: uma página, chave, tomador, aviso de teste e marca de cancelada", async () => {
    const { nfseFicticia } = await import("./apoio/nfse-ficticia");
    const { gerarDanfse } = await import("@/lib/nfse-emissao/danfse");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { xml: dps } = dpsAssinada(base, chaves);
    const { xml, chave } = nfseFicticia(dps, { cnpj: "11444777000161", numero: 15, ambiente: 2, chaves });
    const ler = async (pdf: Buffer) => {
      const doc = await getDocumentProxy(new Uint8Array(pdf));
      const { text, totalPages } = await extractText(doc, { mergePages: true });
      return { texto: (Array.isArray(text) ? text.join("\n") : text).replace(/\s+/g, " "), paginas: totalPages };
    };
    const normal = await ler(await gerarDanfse(xml));
    expect(normal.paginas).toBe(1);
    expect(normal.texto).toContain("DANFSe v2.0");
    expect(normal.texto).toContain(chave);
    expect(normal.texto).toContain("NFS-e SEM VALIDADE JURÍDICA");
    expect(normal.texto).toContain("Cliente Fictício & Filhos Ltda");
    expect(normal.texto).toContain("12.345.678/0001-95");
    expect(normal.texto).toContain("R$ 1.500,00");
    expect(normal.texto).toContain("Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)");
    expect(normal.texto).toContain("6,00% (Simples Nacional)");
    expect(normal.texto).not.toContain("CANCELADA");
    const cancelada = await ler(await gerarDanfse(xml, { cancelada: true }));
    expect(cancelada.texto).toContain("CANCELADA");
    expect(cancelada.texto).toContain("NFS-e Cancelada");
  });
});

describe("NFS-e: DPS no leiaute da NT 009 (produção restrita)", () => {
  const nt009: DadosDps = {
    ...base,
    leiaute: undefined,
    servico: { ...base.servico, codigoNbs: "113022100", atividadeSimples: 7, ibscbs: { indicadorOperacao: "100301", classificacao: "200052" } },
  };

  it("finalidade, destinatário, IBS/CBS pelo Simples, NBS, atividade do Simples e grupo IBSCBS; passa no esquema ajustado e a assinatura confere", () => {
    const { xml } = dpsAssinada(nt009, chaves);
    expect(xml).toContain("<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>1718204</cLocEmi>");
    expect(xml).toContain("<regApTribSN>1</regApTribSN><regApIBSCBSSN>1</regApIBSCBSSN><regEspTrib>0</regEspTrib>");
    expect(xml).toContain("</toma><indDest>0</indDest><serv>");
    expect(xml).toContain("<cTribNac>170101</cTribNac><cNBS>113022100</cNBS><cAtvSN>07</cAtvSN><xDescServ>");
    expect(xml).toContain(
      "</valores><IBSCBS><cIndOp>100301</cIndOp><valores><trib><CST>200</CST><cClassTrib>200052</cClassTrib><gIBSCBS></gIBSCBS></trib></valores></IBSCBS></infDPS>",
    );
    if (temXmllint) expect(validar(xml, "DPS_v1.01.xsd", XSD_NT009)).toBe("ok");
    expect(assinaturaConfere(xml)).toBe(true);
  });

  it("produção continua no leiaute 1.01, sem os campos novos", () => {
    const { xml } = dpsAssinada({ ...nt009, ambiente: "producao" }, chaves);
    for (const campo of ["finNFSe", "indDest", "regApIBSCBSSN", "cAtvSN", "IBSCBS"]) expect(xml).not.toContain(`<${campo}>`);
    expect(xml).toContain("</xDescServ><cNBS>113022100</cNBS>");
    if (temXmllint) expect(validar(xml, "DPS_v1.01.xsd")).toBe("ok");
  });

  it("isenção (CST 400) vai sem indicador da operação e sem o grupo de tributação; não optante não informa os campos do Simples", () => {
    const { xml } = dpsAssinada(
      {
        ...nt009,
        prestador: { ...nt009.prestador, opcaoSimples: 1 },
        tributosAproximados: { tipo: "percentuais", federal: "13.45", estadual: "0", municipal: "5" },
        servico: { ...nt009.servico, atividadeSimples: null, ibscbs: { indicadorOperacao: "100301", classificacao: "400001" } },
      },
      chaves,
    );
    expect(xml).toContain("<IBSCBS><valores><trib><CST>400</CST><cClassTrib>400001</cClassTrib></trib></valores></IBSCBS>");
    expect(xml).not.toContain("<regApIBSCBSSN>");
    expect(xml).not.toContain("<cAtvSN>");
    if (temXmllint) expect(validar(xml, "DPS_v1.01.xsd", XSD_NT009)).toBe("ok");
  });

  it("sem NBS, sem classificação do IBS/CBS ou sem a atividade do Simples, a nota não sai do portal", () => {
    expect(() => montarInfDps({ ...nt009, servico: { ...nt009.servico, codigoNbs: null } })).toThrow(/NBS/);
    expect(() => montarInfDps({ ...nt009, servico: { ...nt009.servico, ibscbs: null } })).toThrow(/classificação do IBS\/CBS/);
    expect(() => montarInfDps({ ...nt009, servico: { ...nt009.servico, atividadeSimples: null } })).toThrow(/atividade do Simples/);
  });
});
