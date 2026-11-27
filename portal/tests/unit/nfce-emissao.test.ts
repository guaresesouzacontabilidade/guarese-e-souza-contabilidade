import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { chaveValida } from "@/lib/fiscal/chave";
import type { EntradaNfe } from "@/lib/nfe-emissao/calculo";
import { nfeAssinada, NOME_HOMOLOGACAO, PRODUTO_HOMOLOGACAO_NFCE } from "@/lib/nfe-emissao/nfe";
import { chaveEmGrupos, nfceNaUf, qrCodeNfce, urlConsultaNfce } from "@/lib/nfe-emissao/nfce";
import { urlServico } from "@/lib/nfe-emissao/sefaz";

/**
 * Cupom fiscal (NFC-e, modelo 65), leiaute 4.00 (esquemas PL_010f em
 * tests/fixtures/nfe-xsd-PL010f) com o QR Code versão 3 da NT 2025.001 (sem
 * CSC na emissão normal). O XML gerado passa no esquema oficial, a assinatura
 * confere e as regras do cupom saem no lugar certo. Dados fictícios.
 */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const chavePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const k = forge.pki.privateKeyFromPem(chavePem) as forge.pki.rsa.PrivateKey;
const c = forge.pki.createCertificate();
c.publicKey = forge.pki.setRsaPublicKey(k.n, k.e);
c.serialNumber = "01" + randomBytes(6).toString("hex");
c.validity.notBefore = new Date(Date.now() - 86_400_000);
c.validity.notAfter = new Date(Date.now() + 86_400_000);
c.setSubject([{ name: "commonName", value: "PADARIA FICTICIA LTDA:11444777000161" }]);
c.setIssuer([{ name: "commonName", value: "PADARIA FICTICIA LTDA:11444777000161" }]);
c.sign(k, forge.md.sha256.create());
const certificadoPem = forge.pki.certificateToPem(c);
const chaves = { chavePem, certificadoPem };

const XSD = resolve("tests/fixtures/nfe-xsd-PL010f");

function validarXsd(xml: string) {
  const pasta = mkdtempSync(join(tmpdir(), "nfce-"));
  const arquivo = join(pasta, "doc.xml");
  writeFileSync(arquivo, xml);
  try {
    execFileSync("xmllint", ["--noout", "--schema", join(XSD, "nfe_v4.00.xsd"), arquivo], { stdio: "pipe" });
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

/** Venda no balcão de uma padaria de Palmas (TO), Simples Nacional: cartão de crédito e dinheiro com troco. */
const cupom: EntradaNfe = {
  modelo: 65,
  ambiente: "homologacao",
  emitidaEm: new Date("2026-11-20T14:00:00Z"),
  serie: 1,
  numero: 7,
  codigoNumerico: "31415926",
  natureza: "Venda de mercadoria",
  finalidade: 1,
  consumidorFinal: true,
  presenca: 1,
  emitente: {
    tipo: "cnpj",
    documento: "11444777000161",
    nome: "Padaria Fictícia Ltda",
    fantasia: "Pão Quente",
    endereco: { logradouro: "Quadra 104 Norte", numero: "10", bairro: "Plano Diretor Norte", codigoMunicipio: "1721000", municipio: "Palmas", uf: "TO", cep: "77006-000" },
    inscricaoEstadual: "29.123.456-7",
    crt: 1,
  },
  consumidor: { tipo: "cpf", documento: "529.982.247-25", nome: "Consumidor Exemplo" },
  itens: [
    {
      codigo: "PAO-FR",
      descricao: "Pão francês (kg)",
      ncm: "19059090",
      cfop: "5102",
      unidade: "KG",
      quantidade: "1.250",
      valorUnitario: "18.00",
      origem: "0",
      icms: { cst: "102" },
      pis: { cst: "49" },
      cofins: { cst: "49" },
      ibscbs: null,
    },
    {
      codigo: "CAFE-500",
      descricao: "Café torrado 500 g",
      ncm: "09012100",
      cfop: "5102",
      unidade: "UN",
      quantidade: "2",
      valorUnitario: "25.00",
      origem: "0",
      icms: { cst: "102" },
      pis: { cst: "49" },
      cofins: { cst: "49" },
      ibscbs: null,
    },
  ],
  desconto: "2.50",
  transporte: { modalidade: 9 },
  pagamento: { forma: "03", aPrazo: false },
  // Total 22,50 + 50,00 − 2,50 = 70,00: 50,00 no crédito e 30,00 em dinheiro (troco de 10,00)
  pagamentos: [
    { forma: "03", valor: "50.00" },
    { forma: "01", valor: "30.00" },
  ],
  informacoesComplementares: "Venda nº 128.",
};

describe("cupom fiscal (NFC-e)", () => {
  it("monta o modelo 65 com QR Code versão 3 (sem CSC), passa no esquema oficial e a assinatura confere", () => {
    const n = nfeAssinada(cupom, chaves);
    expect(chaveValida(n.chave)).toBe(true);
    expect(n.chave.slice(0, 2)).toBe("17");
    expect(n.chave.slice(20, 22)).toBe("65");
    expect(n.qrCode).toBe(`http://homologacao.sefaz.to.gov.br/nfce/qrcode?p=${n.chave}|3|2`);
    expect(n.urlChave).toBe("http://homologacao.sefaz.to.gov.br/nfce/consulta");
    expect(validarXsd(n.xml)).toBe("ok");
    expect(assinaturaConfere(n.xml)).toBe(true);
    // O QR Code fica fora da parte assinada, entre o infNFe e a assinatura
    expect(n.xml).toMatch(/<\/infNFe><infNFeSupl><qrCode>[^<]+<\/qrCode><urlChave>[^<]+<\/urlChave><\/infNFeSupl><Signature/);
  });

  it("segue as regras do cupom: presencial, consumidor final, DANFE NFC-e, sem transporte nem cobrança, troco e cartão", () => {
    const { xml } = nfeAssinada(cupom, chaves);
    expect(xml).toContain("<mod>65</mod>");
    expect(xml).toContain("<tpImp>4</tpImp>");
    expect(xml).toContain("<idDest>1</idDest>");
    expect(xml).toContain("<indFinal>1</indFinal><indPres>1</indPres>");
    expect(xml).not.toContain("<indIntermed>");
    expect(xml).not.toContain("<dhSaiEnt>");
    expect(xml).toContain("<transp><modFrete>9</modFrete></transp>");
    expect(xml).not.toContain("<cobr>");
    // Consumidor identificado: CPF, nome de teste em homologação, não contribuinte e sem endereço
    expect(xml).toContain(`<dest><CPF>52998224725</CPF><xNome>${NOME_HOMOLOGACAO}</xNome><indIEDest>9</indIEDest></dest>`);
    // Em homologação, a descrição do primeiro item é o texto fixo; os demais seguem
    expect(xml).toContain(`<xProd>${PRODUTO_HOMOLOGACAO_NFCE}</xProd>`);
    expect(xml).toContain("<xProd>Café torrado 500 g</xProd>");
    expect(xml).toContain("<vNF>70.00</vNF>");
    expect(xml).toContain(
      "<pag><detPag><indPag>0</indPag><tPag>03</tPag><vPag>50.00</vPag><card><tpIntegra>2</tpIntegra></card></detPag>" +
        "<detPag><indPag>0</indPag><tPag>01</tPag><vPag>30.00</vPag></detPag><vTroco>10.00</vTroco></pag>",
    );
  });

  it("em produção: descrição verdadeira do produto, nome do consumidor e QR Code do ambiente de produção", () => {
    const n = nfeAssinada({ ...cupom, ambiente: "producao" }, chaves);
    expect(n.qrCode).toBe(`http://www.sefaz.to.gov.br/nfce/qrcode?p=${n.chave}|3|1`);
    expect(n.xml).toContain("<xProd>Pão francês (kg)</xProd>");
    expect(n.xml).toContain("<xNome>Consumidor Exemplo</xNome>");
    expect(n.xml).toContain("<tpAmb>1</tpAmb>");
    expect(validarXsd(n.xml)).toBe("ok");
  });

  it("consumidor sem identificação: o cupom sai sem o grupo do destinatário", () => {
    const { xml } = nfeAssinada({ ...cupom, consumidor: null, pagamentos: [{ forma: "17", valor: "70.00" }] }, chaves);
    expect(xml).not.toContain("<dest>");
    expect(xml).toContain("<tPag>17</tPag><vPag>70.00</vPag></detPag></pag>");
    expect(validarXsd(xml)).toBe("ok");
  });

  it("recusa pagamento que não fecha, troco sem dinheiro e estado ainda não conferido", () => {
    expect(() => nfeAssinada({ ...cupom, pagamentos: [{ forma: "03", valor: "60.00" }] }, chaves)).toThrow(/não cobrem o total/);
    expect(() => nfeAssinada({ ...cupom, pagamentos: [{ forma: "03", valor: "80.00" }] }, chaves)).toThrow(/troco só existe com dinheiro/);
    const mt = { ...cupom, emitente: { ...cupom.emitente, endereco: { ...cupom.emitente.endereco, uf: "MT", codigoMunicipio: "5100201", municipio: "Água Boa" } } };
    expect(() => nfeAssinada(mt, chaves)).toThrow(/ainda não está disponível no portal para MT/);
    expect(nfceNaUf("TO")).toBe(true);
    expect(nfceNaUf("MT")).toBe(false);
  });

  it("usa os servidores do cupom (SVRS NFC-e) e não os da NF-e", () => {
    expect(urlServico("TO", "homologacao", "autorizacao", 65)).toBe("https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx");
    expect(urlServico("TO", "producao", "evento", 65)).toBe("https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx");
    expect(urlServico("TO", "producao", "autorizacao")).toBe("https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx");
    expect(() => urlServico("MT", "producao", "autorizacao", 65)).toThrow(/ainda não está disponível/);
  });

  it("QR Code e consulta: só chave de cupom e endereços do estado", () => {
    expect(() => qrCodeNfce("17261111444777000161550010000000071314159260", "homologacao", "TO")).toThrow(/inválida/);
    expect(urlConsultaNfce("to", "producao")).toBe("http://www.sefaz.to.gov.br/nfce/consulta");
    expect(chaveEmGrupos("17261111444777000161650010000000071314159265")).toBe("1726 1111 4447 7700 0161 6500 1000 0000 0713 1415 9265");
  });
});
