import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { chaveValida } from "@/lib/fiscal/chave";
import { dec, fmt } from "@/lib/nfe-emissao/decimal";
import { calcularCte, calcularIcmsCte, type EntradaCte } from "@/lib/cte-emissao/calculo";
import { chaveCte, cteAssinado, montarCte, NOME_HOMOLOGACAO_CTE } from "@/lib/cte-emissao/cte";
import { eventoCancelamentoCte, eventoCartaCorrecaoCte } from "@/lib/cte-emissao/eventos";
import {
  autorizadorCteDaUf,
  consultarCte,
  enviarCte,
  enviarEventoCte,
  eventoRegistrado,
  montarCteProc,
  montarProcEventoCte,
  statusServicoCte,
  urlQrCode,
  urlServicoCte,
  type ConexaoSefazCte,
} from "@/lib/cte-emissao/sefaz";
import { CHAVE_NFE_MILHO, freteMilho } from "./apoio/cte-ficticio";

/**
 * CT-e modelo 57 (leiaute 4.00, esquemas PL_CTe_400 da NT 2026.002 v1.01 em
 * tests/fixtures/cte-xsd-NT2026002, publicados no Portal Nacional do CT-e):
 * o XML gerado passa nos esquemas oficiais, a assinatura confere, os valores
 * seguem o Manual de Orientação e a conversa com o autorizador (SOAP 1.2) é
 * testada contra um servidor local que faz o papel da SEFAZ. Nada sai da
 * máquina. Dados fictícios.
 */
function par() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const k = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  return { pem, k, pub: forge.pki.setRsaPublicKey(k.n, k.e) };
}
function cert(p: ReturnType<typeof par>, cn: string, emissor?: { p: ReturnType<typeof par>; c: forge.pki.Certificate }, dns?: string) {
  const c = forge.pki.createCertificate();
  c.publicKey = p.pub;
  c.serialNumber = "01" + randomBytes(6).toString("hex");
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  const sujeito = [{ name: "commonName", value: cn }];
  c.setSubject(sujeito);
  c.setIssuer(emissor ? emissor.c.subject.attributes : sujeito);
  c.setExtensions([{ name: "basicConstraints", cA: !emissor }, ...(dns ? [{ name: "subjectAltName", altNames: [{ type: 2, value: dns }] }] : [])]);
  c.sign(emissor?.p.k ?? p.k, forge.md.sha256.create());
  return { c, pem: forge.pki.certificateToPem(c) };
}

const pAc = par();
const ac = cert(pAc, "AC TESTE LOCAL");
const pEmp = par();
const cEmp = cert(pEmp, "TRANSPORTADORA FICTICIA VAP LTDA:55777088000144", { p: pAc, c: ac.c });
const chaves = { chavePem: pEmp.pem, certificadoPem: cEmp.pem };

const temXmllint = (() => {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Valida contra os esquemas oficiais (cópia numa pasta temporária, com um esquema auxiliar opcional). */
function validar(xml: string, esquema: string, extra?: string) {
  const pasta = mkdtempSync(join(tmpdir(), "cte-xsd-"));
  cpSync(resolve("tests/fixtures/cte-xsd-NT2026002"), pasta, { recursive: true });
  if (extra) writeFileSync(join(pasta, "teste.xsd"), extra);
  const arq = join(pasta, "doc.xml");
  writeFileSync(arq, xml.replace(/^<\?xml[^>]*\?>/, ""));
  try {
    execFileSync("xmllint", ["--noout", "--schema", join(pasta, esquema), arq], { stdio: "pipe" });
    return "ok";
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

/** O conteúdo dos grupos "any" (modal e detalhe do evento) é validado no esquema próprio. */
const trecho = (xml: string, nome: string) => new RegExp(`<${nome}\\b[\\s\\S]*?</${nome}>`).exec(xml)![0].replace(`<${nome}`, `<${nome} xmlns="http://www.portalfiscal.inf.br/cte"`);

function assinaturaConfere(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const v = new SignedXml({ publicCert: chaves.certificadoPem });
  v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0] as unknown as Node);
  return v.checkSignature(xml);
}

describe("autorizadores do CT-e", () => {
  it("cada UF no seu autorizador, com os endereços do Portal Nacional do CT-e", () => {
    expect(autorizadorCteDaUf("MT")).toBe("MT");
    expect(autorizadorCteDaUf("TO")).toBe("SVRS");
    expect(autorizadorCteDaUf("PE")).toBe("SVSP");
    expect(autorizadorCteDaUf("GO")).toBe("SVRS");
    expect(urlServicoCte("MT", "producao", "recepcao")).toBe("https://cte.sefaz.mt.gov.br/ctews2/services/CTeRecepcaoSincV4");
    expect(urlServicoCte("MT", "homologacao", "evento")).toBe("https://homologacao.sefaz.mt.gov.br/ctews2/services/CTeRecepcaoEventoV4");
    expect(urlServicoCte("TO", "producao", "consulta")).toBe("https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx");
    expect(urlServicoCte("AP", "homologacao", "status")).toBe("https://homologacao.nfe.fazenda.sp.gov.br/CTeWS/WS/CTeStatusServicoV4.asmx");
    expect(urlServicoCte("MS", "producao", "recepcao")).toBe("https://producao.cte.ms.gov.br/ws/CTeRecepcaoSincV4");
    expect(urlQrCode("MT", "homologacao")).toBe("https://homologacao.sefaz.mt.gov.br/cte/qrcode");
    expect(urlQrCode("TO", "producao")).toBe("https://dfe-portal.svrs.rs.gov.br/cte/qrCode");
    expect(() => autorizadorCteDaUf("XX")).toThrow();
  });
});

describe("cálculo do CT-e", () => {
  it("ICMS do frete, IBS/CBS sem o ICMS na base e total do documento em 2026", () => {
    const c = calcularCte(freteMilho);
    expect(fmt(c.vTPrest, 2)).toBe("4500.00");
    expect(c.icms.grupo).toBe("ICMS00");
    expect(fmt(c.icms.vICMS, 2)).toBe("540.00");
    // IBS/CBS sobre 4.500 − 540 = 3.960: CBS 0,9% = 35,64; IBS UF 0,1% = 3,96
    expect(fmt(c.ibscbs!.vBC, 2)).toBe("3960.00");
    expect(fmt(c.ibscbs!.cbs.valor, 2)).toBe("35.64");
    expect(fmt(c.ibscbs!.vIBS, 2)).toBe("3.96");
    expect(fmt(c.vTotDFe, 2)).toBe("4500.00");
    expect(fmt(c.vTotTrib, 2)).toBe("579.60");
  });

  it("redução de base (CST 20), ST pelo tomador (CST 60), outros (CST 90) e Simples Nacional", () => {
    const v = dec("1000");
    const r20 = calcularIcmsCte({ cst: "20", aliquota: 12, reducaoBase: 20 }, v);
    expect([fmt(r20.vBC, 2), fmt(r20.vICMS, 2)]).toEqual(["800.00", "96.00"]);
    const r60 = calcularIcmsCte({ cst: "60", aliquota: 12, creditoPresumido: 20 }, v);
    expect([r60.grupo, fmt(r60.vICMS, 2), fmt(r60.vCred!, 2)]).toEqual(["ICMS60", "120.00", "24.00"]);
    const r90 = calcularIcmsCte({ cst: "90", aliquota: 7 }, v);
    expect([r90.grupo, fmt(r90.vBC, 2), fmt(r90.vICMS, 2)]).toEqual(["ICMS90", "1000.00", "70.00"]);
    expect(calcularIcmsCte({ cst: "41" }, v).grupo).toBe("ICMS45");
    expect(calcularIcmsCte({ cst: "sn" }, v)).toMatchObject({ grupo: "ICMSSN", cst: "90" });
    expect(() => calcularIcmsCte({ cst: "00" }, v)).toThrow(/alíquota/);
  });

  it("recusa valores incoerentes", () => {
    expect(() => calcularCte({ ...freteMilho, valorReceber: "4600.00" })).toThrow(/receber/);
    expect(() => calcularCte({ ...freteMilho, componentes: [{ nome: "FRETE", valor: 1 }] })).toThrow(/componentes/);
    expect(() => montarCte({ ...freteMilho, cfop: "5353" })).toThrow(/CFOP/);
    expect(() => montarCte({ ...freteMilho, nfes: [] })).toThrow(/NF-e/);
  });
});

describe("XML do CT-e 4.00", () => {
  it("chave de 44 dígitos (modelo 57) com o dígito verificador", () => {
    const chave = chaveCte({ uf: "MT", emitidoEm: freteMilho.emitidoEm, documento: "55777088000144", serie: 1, numero: 27, codigoNumerico: "73519284" });
    expect(chave).toMatch(/^512610557770880001445700100000002717351928\d{2}$/);
    expect(chaveValida(chave)).toBe(true);
  });

  it("passa no esquema oficial, com o modal rodoviário, a assinatura e o QR Code", () => {
    const m = cteAssinado(freteMilho, chaves);
    expect(m.xml).toMatch(/^<CTe xmlns="http:\/\/www.portalfiscal.inf.br\/cte"><infCte Id="CTe\d{44}" versao="4.00"><ide><cUF>51<\/cUF>/);
    expect(m.xml).toContain("<CFOP>6353</CFOP>");
    expect(m.xml).toContain(`<infNFe><chave>${CHAVE_NFE_MILHO}</chave></infNFe>`);
    expect(m.xml).toContain("<vTotDFe>4500.00</vTotDFe>");
    expect(m.xml).toContain(`<qrCodCTe>https://homologacao.sefaz.mt.gov.br/cte/qrcode?chCTe=${m.chave}&amp;tpAmb=2</qrCodCTe>`);
    // Homologação: razão social fixa do remetente e do destinatário; a do emitente fica a verdadeira
    expect(m.xml.split(NOME_HOMOLOGACAO_CTE).length - 1).toBe(2);
    expect(m.xml).toContain("<xNome>Transportadora Fictícia VAP Ltda</xNome>");
    expect(assinaturaConfere(m.xml)).toBe(true);
    if (temXmllint) {
      expect(validar(m.xml, "cte_v4.00.xsd")).toBe("ok");
      expect(validar(trecho(m.xml, "rodo"), "cteModalRodoviario_v4.00.xsd")).toBe("ok");
    }
  });

  it("outras combinações também passam no esquema: tomador terceiro, CST 20/60/90/41 e Simples Nacional", () => {
    if (!temXmllint) return;
    const terceiro: EntradaCte = {
      ...freteMilho,
      ambiente: "producao",
      tomador: { papel: 4, indicadorIe: 1, participante: { ...freteMilho.destinatario, documento: "11222333000181", nome: "Trading Exemplo Ltda" } },
    };
    const casos: EntradaCte[] = [
      terceiro,
      { ...freteMilho, icms: { cst: "20", aliquota: 12, reducaoBase: 20 } },
      { ...freteMilho, icms: { cst: "60", aliquota: 12, creditoPresumido: 20 } },
      { ...freteMilho, icms: { cst: "90", aliquota: 12, reducaoBase: 10, creditoPresumido: 5 } },
      { ...freteMilho, icms: { cst: "41" }, observacoes: null, componentes: [], carga: { produto: "SOJA", pesoKg: "1.5" } },
      { ...freteMilho, emitente: { ...freteMilho.emitente, crt: 1 }, icms: { cst: "sn" }, responsavelTecnico: null, autorizadosXml: [] },
      {
        ...freteMilho,
        cfop: "5353",
        fim: { codigoMunicipio: "5107602", municipio: "Rondonópolis", uf: "MT" },
        tomador: { papel: 0, indicadorIe: 1 },
        remetente: { ...freteMilho.remetente, tipo: "cpf", documento: "52998224725", nome: "Produtor Exemplo" },
      },
    ];
    for (const e of casos) {
      const m = cteAssinado(e, chaves);
      expect(validar(m.xml, "cte_v4.00.xsd"), e.icms.cst).toBe("ok");
    }
    // Produção: os nomes verdadeiros, e o tomador terceiro no toma4
    const p = cteAssinado(terceiro, chaves).xml;
    expect(p).not.toContain(NOME_HOMOLOGACAO_CTE);
    expect(p).toContain("<toma4><toma>4</toma><CNPJ>11222333000181</CNPJ>");
    expect(p).toContain("<tpAmb>1</tpAmb>");
  });

  it("eventos: cancelamento e carta de correção campo a campo passam nos esquemas", () => {
    const m = montarCte(freteMilho);
    const comum = { ambiente: "homologacao" as const, uf: "MT", chave: m.chave, documento: "55777088000144", quando: new Date("2026-10-21T15:00:00Z") };
    const canc = eventoCancelamentoCte({ ...comum, protocolo: "151260000012345", justificativa: "Frete desfeito: carga não embarcada" }, chaves);
    expect(canc.id).toBe(`ID110111${m.chave}001`);
    const cce = eventoCartaCorrecaoCte(
      {
        ...comum,
        sequencia: 2,
        correcoes: [
          { grupo: "compl", campo: "xObs", valor: "Placa correta: XYZ9A87" },
          { grupo: "infQ", campo: "qCarga", valor: "30010.0000", item: 1 },
        ],
      },
      chaves,
    );
    expect(cce.id).toBe(`ID110110${m.chave}002`);
    expect(cce.xml).toContain("<nroItemAlterado>01</nroItemAlterado>");
    expect(assinaturaConfere(canc.xml)).toBe(true);
    expect(assinaturaConfere(cce.xml)).toBe(true);
    expect(() => eventoCancelamentoCte({ ...comum, protocolo: "151260000012345", justificativa: "curta" }, chaves)).toThrow(/15 a 255/);
    expect(() => eventoCartaCorrecaoCte({ ...comum, sequencia: 1, correcoes: [] }, chaves)).toThrow(/1 a 20/);
    if (temXmllint) {
      expect(validar(canc.xml, "eventoCTe_v4.00.xsd")).toBe("ok");
      expect(validar(cce.xml, "eventoCTe_v4.00.xsd")).toBe("ok");
      expect(validar(trecho(canc.xml, "evCancCTe"), "evCancCTe_v4.00.xsd")).toBe("ok");
      expect(validar(trecho(cce.xml, "evCCeCTe"), "evCCeCTe_v4.00.xsd")).toBe("ok");
    }
  });
});

describe("SOAP com o autorizador do CT-e (servidor local)", () => {
  let servidor: https.Server;
  let conexao: ConexaoSefazCte;
  let modo: "autoriza" | "rejeita" | "esquema" | "evento_duplicado" = "autoriza";
  const recebidos: { url: string; acao: string; corpo: string }[] = [];
  const NS = 'xmlns="http://www.portalfiscal.inf.br/cte"';

  const resposta = (corpo: string) =>
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><cteRecepcaoResult xmlns="http://www.portalfiscal.inf.br/cte/wsdl/X">${corpo}</cteRecepcaoResult></soap:Body></soap:Envelope>`;
  const prot = (chave: string, cStat = "100", xMotivo = "Autorizado o uso do CT-e") =>
    `<protCTe versao="4.00"><infProt Id="CTe151260000012345"><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><chCTe>${chave}</chCTe><dhRecbto>2026-10-20T11:00:05-04:00</dhRecbto>` +
    `${cStat === "100" ? "<nProt>151260000012345</nProt><digVal>qjK4Sg+MZ5rgk1kZ8qCw3GQXy5o=</digVal>" : ""}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protCTe>`;
  const retEvento = (chave: string, tp: string, seq: string, cStat = "135") =>
    `<retEventoCTe ${NS} versao="4.00"><infEvento><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><cOrgao>51</cOrgao><cStat>${cStat}</cStat>` +
    `<xMotivo>${cStat === "135" ? "Evento registrado e vinculado a CT-e" : "Rejeicao: Duplicidade de evento"}</xMotivo>` +
    (cStat === "135"
      ? `<chCTe>${chave}</chCTe><tpEvento>${tp}</tpEvento><xEvento>${tp === "110111" ? "Cancelamento" : "Carta de Correcao"}</xEvento><nSeqEvento>${seq}</nSeqEvento><dhRegEvento>2026-10-21T11:00:00-04:00</dhRegEvento><nProt>151260000099999</nProt>`
      : "") +
    "</infEvento></retEventoCTe>";
  let ultimoEvento = "";

  beforeAll(async () => {
    const pSrv = par();
    const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");
    servidor = https.createServer({ key: pSrv.pem, cert: cSrv.pem, ca: [ac.pem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let corpo = "";
      req.on("data", (d) => (corpo += d));
      req.on("end", () => {
        const acao = /action="([^"]+)"/.exec(String(req.headers["content-type"]))?.[1] ?? "";
        recebidos.push({ url: req.url ?? "", acao, corpo });
        res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
        const cab = "<tpAmb>2</tpAmb><cUF>51</cUF><verAplic>MT_TESTE</verAplic>";
        if (req.url === "/recepcao") {
          const b64 = /<cteDadosMsg[^>]*>([^<]+)<\/cteDadosMsg>/.exec(corpo)?.[1] ?? "";
          const xml = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
          const chave = /Id="CTe(\d{44})"/.exec(xml)?.[1] ?? "";
          if (modo === "esquema") return res.end(resposta(`<retCTe ${NS} versao="4.00">${cab}<cStat>215</cStat><xMotivo>Rejeicao: Falha no schema XML</xMotivo></retCTe>`));
          const p = modo === "rejeita" ? prot(chave, "646", "Rejeicao: Remetente invalido para ambiente de homologacao") : prot(chave);
          return res.end(resposta(`<retCTe ${NS} versao="4.00">${cab}<cStat>${modo === "rejeita" ? "646" : "100"}</cStat><xMotivo>ok</xMotivo>${p}</retCTe>`));
        }
        const chave = /<chCTe>(\d{44})<\/chCTe>/.exec(corpo)?.[1] ?? "";
        if (req.url === "/consulta") {
          const proc = ultimoEvento
            ? `<procEventoCTe versao="4.00">${ultimoEvento.replace(` ${NS}`, "")}${retEvento(chave, "110111", "1").replace(` ${NS}`, "")}</procEventoCTe>`
            : "";
          return res.end(resposta(`<retConsSitCTe ${NS} versao="4.00"><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><cStat>100</cStat><xMotivo>Autorizado o uso do CT-e</xMotivo><cUF>51</cUF>${prot(chave)}${proc}</retConsSitCTe>`));
        }
        if (req.url === "/status") return res.end(resposta(`<retConsStatServCTe ${NS} versao="4.00">${cab.replace("<cUF>51</cUF>", "")}<cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto><tMed>1</tMed></retConsStatServCTe>`));
        if (req.url === "/evento") {
          const ev = /<eventoCTe[\s\S]*<\/eventoCTe>/.exec(corpo)![0];
          const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(corpo)?.[1] ?? "";
          const seq = /<nSeqEvento>(\d+)<\/nSeqEvento>/.exec(corpo)?.[1] ?? "";
          if (modo === "evento_duplicado") return res.end(resposta(retEvento(chave, tp, seq, "631")));
          ultimoEvento = ev;
          return res.end(resposta(retEvento(chave, tp, seq)));
        }
        res.end("?");
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    const porta = (servidor.address() as AddressInfo).port;
    conexao = { uf: "MT", ambiente: "homologacao", credencial: { chave: pEmp.pem, certificados: [cEmp.pem] }, base: `https://localhost:${porta}`, ca: [ac.pem] };
  });
  afterAll(() => servidor?.close());

  it("recepção síncrona: XML compactado em Base64, protocolo 100 e cteProc válido no esquema", async () => {
    modo = "autoriza";
    const m = cteAssinado(freteMilho, chaves);
    const r = await enviarCte(conexao, m.xml, m.chave);
    expect(r.tipo).toBe("protocolo");
    if (r.tipo !== "protocolo") return;
    expect(r.protocolo).toMatchObject({ chave: m.chave, cStat: "100", protocolo: "151260000012345" });
    const ultimo = recebidos.at(-1)!;
    expect(ultimo.acao).toBe("http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao");
    expect(ultimo.corpo).toContain('<cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4">H4sI');
    const proc = montarCteProc(m.xml, r.protocolo.xml!);
    expect(proc).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><cteProc xmlns="http:\/\/www.portalfiscal.inf.br\/cte" versao="4.00"><CTe><infCte/);
    expect(assinaturaConfere(proc)).toBe(true);
    if (temXmllint) expect(validar(proc, "procCTe_v4.00.xsd")).toBe("ok");
    // DACTE do CT-e autorizado (e o de teste, antes da autorização)
    const { gerarDacte } = await import("@/lib/cte-emissao/dacte");
    const pdf = await gerarDacte(proc);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    if (process.env.DACTE_SAIDA) writeFileSync(process.env.DACTE_SAIDA, pdf);
    expect((await gerarDacte(m.xml, { cancelado: true })).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("rejeição com protocolo e recusa antes do processamento chegam com o código da SEFAZ", async () => {
    const m = cteAssinado(freteMilho, chaves);
    modo = "rejeita";
    const r = await enviarCte(conexao, m.xml, m.chave);
    expect(r.tipo === "protocolo" && r.protocolo.cStat).toBe("646");
    modo = "esquema";
    expect(await enviarCte(conexao, m.xml, m.chave)).toEqual({ tipo: "rejeitado", cStat: "215", xMotivo: "Rejeicao: Falha no schema XML" });
  });

  it("consulta pela chave, status do serviço e eventos (com o evento já registrado achado na consulta)", async () => {
    modo = "autoriza";
    const m = montarCte(freteMilho);
    const s = await consultarCte(conexao, m.chave);
    expect(s.cStat).toBe("100");
    expect(s.protocolo?.protocolo).toBe("151260000012345");
    expect(recebidos.at(-1)!.corpo).toContain(`<consSitCTe ${NS} versao="4.00"><tpAmb>2</tpAmb><xServ>CONSULTAR</xServ><chCTe>${m.chave}</chCTe></consSitCTe>`);
    expect((await statusServicoCte(conexao)).cStat).toBe("107");
    if (temXmllint) expect(validar(/<consStatServCTe[\s\S]*<\/consStatServCTe>/.exec(recebidos.at(-1)!.corpo)![0], "consStatServCTe_v4.00.xsd")).toBe("ok");

    const canc = eventoCancelamentoCte(
      { ambiente: "homologacao", uf: "MT", chave: m.chave, documento: "55777088000144", quando: new Date("2026-10-21T15:00:00Z"), protocolo: "151260000012345", justificativa: "Frete desfeito: carga não embarcada" },
      chaves,
    );
    const rc = await enviarEventoCte(conexao, canc.xml);
    expect(rc).toMatchObject({ cStat: "135", protocolo: "151260000099999" });
    expect(recebidos.at(-1)!.acao).toBe("http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento");
    expect(recebidos.at(-1)!.corpo).toContain('<cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4"><eventoCTe ');
    const proc = montarProcEventoCte(canc.xml, rc.xml!);
    if (temXmllint) expect(validar(proc, "procEventoCTe_v4.00.xsd")).toBe("ok");

    // Resposta perdida: a SEFAZ recusa o reenvio, e a consulta traz o evento registrado
    modo = "evento_duplicado";
    const dup = await enviarEventoCte(conexao, canc.xml);
    expect(dup.cStat).toBe("631");
    const sit = await consultarCte(conexao, m.chave);
    const ja = eventoRegistrado(sit.eventos, "110111", 1);
    expect(ja?.retorno.protocolo).toBe("151260000099999");
    expect(eventoRegistrado(sit.eventos, "110110", 1)).toBeNull();
    if (temXmllint) expect(validar(ja!.proc, "procEventoCTe_v4.00.xsd")).toBe("ok");
  });
});
