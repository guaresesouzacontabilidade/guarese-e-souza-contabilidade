import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { chaveValida } from "@/lib/fiscal/chave";
import { calcularNota, dataHoraUf, type EntradaNfe } from "@/lib/nfe-emissao/calculo";
import { fmt } from "@/lib/nfe-emissao/decimal";
import { chaveDeAcesso, montarNfe, nfeAssinada, NOME_HOMOLOGACAO, sortearCodigoNumerico } from "@/lib/nfe-emissao/nfe";
import { vendaMilho } from "./apoio/nfe-ficticia";

/**
 * NF-e modelo 55 (leiaute 4.00, esquemas PL_010f v1.04 de 31/08/2026 em
 * tests/fixtures/nfe-xsd-PL010f, publicados no Portal Nacional da NF-e): o
 * XML gerado passa nos esquemas oficiais, a assinatura confere e os valores
 * seguem as fórmulas do Manual de Orientação e da NT 2025.002-RTC.
 * Dados fictícios.
 */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const chavePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const k = forge.pki.privateKeyFromPem(chavePem) as forge.pki.rsa.PrivateKey;
const c = forge.pki.createCertificate();
c.publicKey = forge.pki.setRsaPublicKey(k.n, k.e);
c.serialNumber = "01" + randomBytes(6).toString("hex");
c.validity.notBefore = new Date(Date.now() - 86_400_000);
c.validity.notAfter = new Date(Date.now() + 86_400_000);
c.setSubject([{ name: "commonName", value: "TRANSPORTADORA FICTICIA LTDA:11444777000161" }]);
c.setIssuer([{ name: "commonName", value: "TRANSPORTADORA FICTICIA LTDA:11444777000161" }]);
c.sign(k, forge.md.sha256.create());
const certificadoPem = forge.pki.certificateToPem(c);
const chaves = { chavePem, certificadoPem };

/** Esquema auxiliar só dos testes: o lote (enviNFe) e a nota com protocolo (nfeProc) com os tipos oficiais. */
const XSD = (() => {
  const pasta = mkdtempSync(join(tmpdir(), "nfe-xsd-"));
  cpSync(resolve("tests/fixtures/nfe-xsd-PL010f"), pasta, { recursive: true });
  writeFileSync(
    join(pasta, "teste-lote.xsd"),
    '<?xml version="1.0" encoding="UTF-8"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="http://www.portalfiscal.inf.br/nfe" ' +
      'targetNamespace="http://www.portalfiscal.inf.br/nfe" elementFormDefault="qualified" attributeFormDefault="unqualified">' +
      '<xs:include schemaLocation="leiauteNFe_v4.00.xsd"/><xs:element name="enviNFe" type="TEnviNFe"/><xs:element name="nfeProc" type="TNfeProc"/>' +
      '<xs:element name="retEnviNFe" type="TRetEnviNFe"/></xs:schema>',
  );
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

function validarXsd(xml: string, esquema: string, pastaXsd = XSD) {
  const pasta = mkdtempSync(join(tmpdir(), "nfe-"));
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

describe("cálculo da NF-e", () => {
  it("ICMS, PIS/COFINS sem o ICMS, IBS/CBS com redução, frete retido, FETHAB e guias", () => {
    const n = calcularNota(vendaMilho);
    const t = n.totais;
    expect(n.idDest).toBe(2);
    expect(fmt(t.vProd, 2)).toBe("34500.00");
    expect(fmt(t.vBC, 2)).toBe("34500.00");
    expect(fmt(t.vICMS, 2)).toBe("4140.00");
    // PIS/COFINS sobre 34.500 − 4.140 = 30.360
    expect(fmt(n.itens[0].pis.vBC, 2)).toBe("30360.00");
    expect(fmt(t.vPIS, 2)).toBe("500.94");
    expect(fmt(t.vCOFINS, 2)).toBe("2307.36");
    // IBS/CBS: 34.500 − 500,94 − 2.307,36 − 4.140 = 27.551,70; alíquotas efetivas 0,04% e 0,36%
    const ib = n.itens[0].ibscbs!;
    expect(fmt(ib.vBC, 2)).toBe("27551.70");
    expect(fmt(ib.uf.pAliqEfet!, 4)).toBe("0.0400");
    expect(fmt(ib.cbs.pAliqEfet!, 4)).toBe("0.3600");
    expect(fmt(ib.uf.valor, 2)).toBe("11.02");
    expect(fmt(ib.cbs.valor, 2)).toBe("99.19");
    expect(fmt(t.vNF, 2)).toBe("34500.00");
    expect(fmt(t.vNFTot!, 2)).toBe("34500.00");
    // Frete: 4.500 com 20% de redução = 3.600 × 12% = 432
    expect(fmt(n.icmsFrete!.vICMSRet, 2)).toBe("432.00");
    // FETHAB: 30 t × 10% × 250,50 = 751,50
    expect(n.contribuicoes.map((c) => [c.nome, fmt(c.valor, 2)])).toEqual([["FETHAB", "751.50"]]);
    expect(n.guias.map((g) => [g.tipo, g.uf, fmt(g.valor, 2)])).toEqual([
      ["icms_operacao", "MT", "4140.00"],
      ["icms_frete", "MT", "432.00"],
      ["contribuicao", "MT", "751.50"],
    ]);
    expect(fmt(n.pesoLiquidoKg!, 3)).toBe("30000.000");
  });

  it("rateia frete, seguro e desconto da nota pelos itens sem perder centavos", () => {
    const e: EntradaNfe = {
      ...vendaMilho,
      transporte: { modalidade: 9 },
      frete: "100.00",
      desconto: "10.01",
      itens: [
        { ...vendaMilho.itens[0], quantidade: "1", valorUnitario: "33.33" },
        { ...vendaMilho.itens[0], codigo: "M2", quantidade: "1", valorUnitario: "33.33" },
        { ...vendaMilho.itens[0], codigo: "M3", quantidade: "1", valorUnitario: "33.34" },
      ],
      pagamento: { forma: "17", aPrazo: false },
    };
    const n = calcularNota(e);
    expect(n.itens.map((i) => fmt(i.vFrete, 2))).toEqual(["33.33", "33.33", "33.34"]);
    expect(fmt(n.totais.vFrete, 2)).toBe("100.00");
    expect(fmt(n.totais.vDesc, 2)).toBe("10.01");
    expect(fmt(n.totais.vNF, 2)).toBe("189.99");
  });

  it("DIFAL para não contribuinte de outro estado: base única e base dupla", () => {
    const e: EntradaNfe = {
      ...vendaMilho,
      consumidorFinal: true,
      destinatario: { ...vendaMilho.destinatario, tipo: "cpf", documento: "52998224725", indicadorIe: 9, inscricaoEstadual: null },
      itens: [{ ...vendaMilho.itens[0], quantidade: "1", valorUnitario: "1000" }],
      transporte: { modalidade: 9 },
      pagamento: { forma: "17", aPrazo: false },
      contribuicoes: [],
      difal: { metodo: "base_unica", aliquotaInterna: 19, fcp: 2 },
    };
    const unica = calcularNota(e);
    // (19 − 12)% de 1.000 = 70; FCP 2% = 20
    expect(fmt(unica.totais.vICMSUFDest, 2)).toBe("70.00");
    expect(fmt(unica.totais.vFCPUFDest, 2)).toBe("20.00");
    expect(unica.guias.map((g) => [g.tipo, g.uf, fmt(g.valor, 2)])).toContainEqual(["difal", "GO", "70.00"]);
    const dupla = calcularNota({ ...e, difal: { metodo: "base_dupla", aliquotaInterna: 19, fcp: 2 } });
    // (1.000 − 120) / (1 − 0,21) = 1.113,92; 1.113,92 × 19% − 120 = 91,64
    expect(fmt(dupla.itens[0].difal!.vBCUFDest, 2)).toBe("1113.92");
    expect(fmt(dupla.totais.vICMSUFDest, 2)).toBe("91.64");
    expect(unica.consumidorFinal).toBe(true);
  });

  it("produtor rural: diferimento (CST 51), FUNRURAL nas informações complementares", () => {
    const e: EntradaNfe = {
      ...vendaMilho,
      serie: 920,
      emitente: { ...vendaMilho.emitente, tipo: "cpf", documento: "52998224725", nome: "Produtor Fictício", crt: 3 },
      destinatario: { ...vendaMilho.destinatario, endereco: { ...vendaMilho.destinatario.endereco, codigoMunicipio: "5103403", municipio: "Cuiabá", uf: "MT" } },
      itens: [{ ...vendaMilho.itens[0], cfop: "5101", quantidade: "500", unidade: "SC", valorUnitario: "60", pesoKgUnidade: "60", icms: { cst: "51", aliquota: 17, diferimento: 100 }, pis: { cst: "08" }, cofins: { cst: "08" } }],
      transporte: { modalidade: 1 },
      pagamento: { forma: "90", aPrazo: false },
      icmsPorOperacao: false,
      contribuicoes: [],
      funrural: { percentual: 1.5, modo: "retido_adquirente" },
    };
    const n = calcularNota(e);
    expect(n.idDest).toBe(1);
    expect(fmt(n.itens[0].icms.vICMSOp, 2)).toBe("5100.00");
    expect(fmt(n.itens[0].icms.vICMS, 2)).toBe("0.00");
    expect(fmt(n.totais.vBC, 2)).toBe("30000.00");
    expect(fmt(n.funrural!.valor, 2)).toBe("450.00");
    expect(n.textosAutomaticos.join(" ")).toContain("FUNRURAL");
    expect(fmt(n.pesoLiquidoKg!, 3)).toBe("30000.000");
    expect(n.guias).toEqual([]);
  });

  it("recusa CFOP que não combina com o destino e série errada do produtor", () => {
    expect(() => calcularNota({ ...vendaMilho, itens: [{ ...vendaMilho.itens[0], cfop: "5102" }] })).toThrow(/não combina com a venda para outro estado/);
    expect(() => montarNfe({ ...vendaMilho, emitente: { ...vendaMilho.emitente, tipo: "cpf", documento: "52998224725" } })).toThrow(/séries 920 a 969/);
    expect(() => calcularNota({ ...vendaMilho, emitidaEm: new Date("2027-01-10T12:00:00Z") })).toThrow(/2027 ainda não estão cadastradas/);
  });
});

describe("XML da NF-e", () => {
  it("chave de acesso com o mês no fuso do emitente e dígito verificador", () => {
    // 20/10/2026 às 01:00 UTC ainda é 19/10 em MT, mas o mês é o mesmo; 01/11 às 02:00 UTC ainda é outubro em MT
    const ch = chaveDeAcesso({ uf: "MT", emitidaEm: new Date("2026-11-01T02:00:00Z"), documento: "11444777000161", serie: 1, numero: 15, codigoNumerico: "48213765" });
    expect(ch).toMatch(/^5126101144477700016155001000000015148213765\d$/);
    expect(chaveValida(ch)).toBe(true);
    expect(dataHoraUf(new Date("2026-11-01T02:00:00Z"), "MT")).toBe("2026-10-31T22:00:00-04:00");
    expect(dataHoraUf(new Date("2026-11-01T02:00:00Z"), "TO")).toBe("2026-10-31T23:00:00-03:00");
    const c = sortearCodigoNumerico(15);
    expect(c).toMatch(/^\d{8}$/);
  });

  it.skipIf(!temXmllint)("passa nos esquemas oficiais e a assinatura confere (venda de milho para outro estado)", () => {
    const nfe = nfeAssinada(vendaMilho, chaves);
    expect(chaveValida(nfe.chave)).toBe(true);
    expect(nfe.xml).toContain(`<xNome>${NOME_HOMOLOGACAO}</xNome>`);
    expect(nfe.xml).toContain("<retTransp><vServ>4500.00</vServ><vBCRet>3600.00</vBCRet><pICMSRet>12.00</pICMSRet><vICMSRet>432.00</vICMSRet><CFOP>6360</CFOP><cMunFG>5100201</cMunFG></retTransp>");
    // Interestadual: placa só nas informações complementares
    expect(nfe.xml).not.toContain("<veicTransp>");
    expect(nfe.xml).toContain("Veículo: placa ABC1D23/MT.");
    expect(nfe.xml).toContain("Pedido 123 &lt;urgente&gt;");
    expect(nfe.xml).toContain("<gRed><pRedAliq>60.0000</pRedAliq><pAliqEfet>0.0400</pAliqEfet></gRed>");
    expect(nfe.xml).toContain("<indIntermed>0</indIntermed>");
    expect(validarXsd(nfe.xml, "nfe_v4.00.xsd")).toBe("ok");
    const lote = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${nfe.xml}</enviNFe>`;
    expect(validarXsd(lote, "teste-lote.xsd")).toBe("ok");
    expect(assinaturaConfere(nfe.xml)).toBe(true);
  });

  it.skipIf(!temXmllint)("passa nos esquemas: produtor rural com diferimento, DIFAL, Simples Nacional e devolução", () => {
    const produtor = nfeAssinada(
      {
        ...vendaMilho,
        serie: 920,
        emitente: { ...vendaMilho.emitente, tipo: "cpf", documento: "52998224725", nome: "Produtor Fictício" },
        destinatario: { ...vendaMilho.destinatario, endereco: { ...vendaMilho.destinatario.endereco, codigoMunicipio: "5103403", municipio: "Cuiabá", uf: "MT" } },
        itens: [{ ...vendaMilho.itens[0], cfop: "5101", icms: { cst: "51", aliquota: 17, diferimento: 100 }, pis: { cst: "08" }, cofins: { cst: "08" }, ibscbs: { cst: "410", classificacao: "410014", reducaoIbs: 0, reducaoCbs: 0 } }],
        transporte: { modalidade: 3, veiculo: { placa: "ABC-1234", uf: "MT", rntc: "12345678" } },
        pagamento: { forma: "90", aPrazo: false },
        funrural: { percentual: 1.5, modo: "retido_adquirente" },
        contribuicoes: [],
      },
      chaves,
    );
    expect(produtor.xml).toContain("<CPF>52998224725</CPF>");
    expect(produtor.xml).toContain("<veicTransp><placa>ABC1234</placa><UF>MT</UF><RNTC>12345678</RNTC></veicTransp>");
    expect(produtor.xml).toContain("<IBSCBS><CST>410</CST><cClassTrib>410014</cClassTrib></IBSCBS>");
    expect(validarXsd(produtor.xml, "nfe_v4.00.xsd")).toBe("ok");
    expect(assinaturaConfere(produtor.xml)).toBe(true);

    const difal = nfeAssinada(
      {
        ...vendaMilho,
        consumidorFinal: true,
        destinatario: { ...vendaMilho.destinatario, tipo: "cpf", documento: "52998224725", indicadorIe: 9, inscricaoEstadual: null, email: null },
        transporte: { modalidade: 9 },
        pagamento: { forma: "99", descricao: "Depósito", aPrazo: false },
        difal: { metodo: "base_unica", aliquotaInterna: 19, fcp: 2 },
        contribuicoes: [],
        responsavelTecnico: null,
        autorizadosXml: [],
      },
      chaves,
    );
    expect(difal.xml).toContain("<pICMSInter>12.00</pICMSInter>");
    expect(difal.xml).toContain("<indFinal>1</indFinal>");
    expect(validarXsd(difal.xml, "nfe_v4.00.xsd")).toBe("ok");

    const simples = nfeAssinada(
      {
        ...vendaMilho,
        emitente: { ...vendaMilho.emitente, crt: 1 },
        itens: [{ ...vendaMilho.itens[0], icms: { cst: "101", creditoSimples: 1.25 }, pis: { cst: "99", aliquota: 0 }, cofins: { cst: "99", aliquota: 0 }, ibscbs: null }],
        transporte: { modalidade: 1 },
        pagamento: { forma: "01", aPrazo: false },
        contribuicoes: [],
        icmsPorOperacao: false,
      },
      chaves,
    );
    expect(simples.xml).toContain("<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>1.25</pCredSN><vCredICMSSN>431.25</vCredICMSSN></ICMSSN101>");
    expect(simples.xml).not.toContain("<IBSCBSTot>");
    expect(validarXsd(simples.xml, "nfe_v4.00.xsd")).toBe("ok");

    const devolucao = nfeAssinada(
      { ...vendaMilho, finalidade: 4, natureza: "Devolução de compra", referencias: [produtor.chave], transporte: { modalidade: 9 }, pagamento: { forma: "90", aPrazo: false }, contribuicoes: [] },
      chaves,
    );
    expect(devolucao.xml).toContain(`<NFref><refNFe>${produtor.chave}</refNFe></NFref>`);
    expect(validarXsd(devolucao.xml, "nfe_v4.00.xsd")).toBe("ok");
  });
});
