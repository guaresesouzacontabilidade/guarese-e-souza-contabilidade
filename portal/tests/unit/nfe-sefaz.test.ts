import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { nfeAssinada } from "@/lib/nfe-emissao/nfe";
import { eventoCancelamento, eventoCartaCorrecao } from "@/lib/nfe-emissao/eventos";
import {
  autorizadorDaUf,
  consultarNota,
  consultarRecibo,
  enviarEvento,
  enviarLote,
  montarNfeProc,
  montarProcEvento,
  statusServico,
  urlServico,
  type ConexaoSefaz,
} from "@/lib/nfe-emissao/sefaz";
import { vendaMilho } from "./apoio/nfe-ficticia";

/**
 * Conversa com o autorizador da NF-e (SOAP 1.2) contra um servidor local que
 * faz o papel da SEFAZ: TLS com certificado do cliente, respostas no formato
 * dos esquemas oficiais. Nada sai da máquina. Dados fictícios.
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

const temXmllint = (() => {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
function validar(xml: string, pastaFixture: string, esquema: string, extra?: string) {
  const pasta = mkdtempSync(join(tmpdir(), "nfe-xsd-"));
  cpSync(resolve(pastaFixture), pasta, { recursive: true });
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

describe("autorizadores da NF-e", () => {
  it("cada UF no seu autorizador, com os endereços do Portal Nacional", () => {
    expect(autorizadorDaUf("MT")).toBe("MT");
    expect(autorizadorDaUf("TO")).toBe("SVRS");
    expect(autorizadorDaUf("MA")).toBe("SVAN");
    expect(urlServico("MT", "homologacao", "autorizacao")).toBe("https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4");
    expect(urlServico("MT", "producao", "consulta")).toBe("https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4");
    expect(urlServico("TO", "producao", "evento")).toBe("https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx");
    expect(urlServico("GO", "homologacao", "autorizacao")).toBe("https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4");
    expect(urlServico("SP", "producao", "retAutorizacao")).toBe("https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx");
    expect(urlServico("BA", "homologacao", "status")).toBe("https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx");
  });
});

describe("SOAP com o autorizador (servidor local)", () => {
  let servidor: https.Server;
  let conexao: ConexaoSefaz;
  let chaves: { chavePem: string; certificadoPem: string };
  let modo: "sincrono" | "assincrono" | "rejeita" | "duplicidade" = "sincrono";
  const recebidos: { url: string; acao: string; corpo: string }[] = [];
  let consultasRecibo = 0;

  const resposta = (corpo: string) =>
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/X">${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`;
  const prot = (chave: string, cStat = "100", xMotivo = "Autorizado o uso da NF-e") =>
    `<protNFe versao="4.00"><infProt Id="ID151260000012345"><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>` +
    `${cStat === "100" ? "<nProt>151260000012345</nProt><digVal>qjK4Sg+MZ5rgk1kZ8qCw3GQXy5o=</digVal>" : ""}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

  beforeAll(async () => {
    const pAc = par();
    const ac = cert(pAc, "AC TESTE LOCAL");
    const pEmp = par();
    const cEmp = cert(pEmp, "TRANSPORTADORA FICTICIA LTDA:11444777000161", { p: pAc, c: ac.c });
    const pSrv = par();
    const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");
    chaves = { chavePem: pEmp.pem, certificadoPem: cEmp.pem };
    servidor = https.createServer({ key: pSrv.pem, cert: cSrv.pem, ca: [ac.pem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let corpo = "";
      req.on("data", (d) => (corpo += d));
      req.on("end", () => {
        const acao = /action="([^"]+)"/.exec(String(req.headers["content-type"]))?.[1] ?? "";
        recebidos.push({ url: req.url ?? "", acao, corpo });
        const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(corpo)?.[1] ?? /Id="NFe(\d{44})"/.exec(corpo)?.[1] ?? "";
        res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
        const cab = '<tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic>';
        if (req.url === "/autorizacao") {
          if (modo === "sincrono") return res.end(resposta(`<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>${prot(chave)}</retEnviNFe>`));
          if (modo === "rejeita") return res.end(resposta(`<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>${prot(chave, "233", "Rejeição: IE do destinatário não cadastrada")}</retEnviNFe>`));
          if (modo === "duplicidade") return res.end(resposta(`<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>${prot(chave, "204", "Rejeição: Duplicidade de NF-e")}</retEnviNFe>`));
          return res.end(resposta(`<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<cStat>103</cStat><xMotivo>Lote recebido com sucesso</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto><infRec><nRec>511000012345678</nRec><tMed>1</tMed></infRec></retEnviNFe>`));
        }
        if (req.url === "/retAutorizacao") {
          consultasRecibo++;
          const ch = recebidos.filter((r) => r.url === "/autorizacao").at(-1)?.corpo.match(/Id="NFe(\d{44})"/)?.[1] ?? "";
          if (consultasRecibo === 1) return res.end(resposta(`<retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<nRec>511000012345678</nRec><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto></retConsReciNFe>`));
          return res.end(resposta(`<retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<nRec>511000012345678</nRec><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>${prot(ch)}</retConsReciNFe>`));
        }
        if (req.url === "/consulta") return res.end(resposta(`<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:01:00-04:00</dhRecbto><chNFe>${chave}</chNFe>${prot(chave)}</retConsSitNFe>`));
        if (req.url === "/status") return res.end(resposta(`<retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${cab}<cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto><tMed>1</tMed></retConsStatServ>`));
        if (req.url === "/evento") {
          const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(corpo)?.[1];
          const seq = /<nSeqEvento>(\d+)<\/nSeqEvento>/.exec(corpo)?.[1];
          return res.end(
            resposta(
              `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${cab}<cOrgao>51</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
                `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><cOrgao>51</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>` +
                `<chNFe>${chave}</chNFe><tpEvento>${tp}</tpEvento><xEvento>${tp === "110111" ? "Cancelamento" : "Carta de Correcao"}</xEvento><nSeqEvento>${seq}</nSeqEvento><dhRegEvento>2026-10-20T11:00:00-04:00</dhRegEvento><nProt>151260000099999</nProt></infEvento></retEvento></retEnvEvento>`,
            ),
          );
        }
        res.end("?");
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    const porta = (servidor.address() as AddressInfo).port;
    conexao = { uf: "MT", ambiente: "homologacao", credencial: { chave: pEmp.pem, certificados: [cEmp.pem] }, base: `https://localhost:${porta}`, ca: [ac.pem] };
  });
  afterAll(() => servidor?.close());

  it("autorização síncrona: protocolo 100 e nfeProc válido no esquema", async () => {
    modo = "sincrono";
    const nfe = nfeAssinada(vendaMilho, chaves);
    const r = await enviarLote(conexao, nfe.xml, nfe.chave, "20261020001");
    expect(r.tipo).toBe("protocolo");
    if (r.tipo !== "protocolo") return;
    expect(r.protocolo).toMatchObject({ chave: nfe.chave, cStat: "100", protocolo: "151260000012345" });
    const ultimo = recebidos.at(-1)!;
    expect(ultimo.acao).toBe("http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote");
    expect(ultimo.corpo).toContain('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>20261020001</idLote><indSinc>1</indSinc><NFe ');
    const proc = montarNfeProc(nfe.xml, r.protocolo.xml!);
    expect(proc).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><nfeProc xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="4.00"><NFe><infNFe/);
    if (temXmllint) {
      const extra =
        '<?xml version="1.0" encoding="UTF-8"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="http://www.portalfiscal.inf.br/nfe" targetNamespace="http://www.portalfiscal.inf.br/nfe" elementFormDefault="qualified" attributeFormDefault="unqualified"><xs:include schemaLocation="leiauteNFe_v4.00.xsd"/><xs:element name="nfeProc" type="TNfeProc"/></xs:schema>';
      expect(validar(proc, "tests/fixtures/nfe-xsd-PL010f", "teste.xsd", extra)).toBe("ok");
    }
  });

  it("rejeição e duplicidade chegam com o código da SEFAZ", async () => {
    const nfe = nfeAssinada(vendaMilho, chaves);
    modo = "rejeita";
    const r = await enviarLote(conexao, nfe.xml, nfe.chave, "2");
    expect(r.tipo === "protocolo" && r.protocolo.cStat).toBe("233");
    modo = "duplicidade";
    const d = await enviarLote(conexao, nfe.xml, nfe.chave, "3");
    expect(d.tipo === "protocolo" && d.protocolo.cStat).toBe("204");
  });

  it("modo assíncrono: recibo, 'em processamento' e depois o protocolo", async () => {
    modo = "assincrono";
    consultasRecibo = 0;
    const nfe = nfeAssinada(vendaMilho, chaves);
    const r = await enviarLote(conexao, nfe.xml, nfe.chave, "4");
    expect(r).toEqual({ tipo: "recibo", recibo: "511000012345678", tempoMedio: 1 });
    expect(await consultarRecibo(conexao, "511000012345678", nfe.chave)).toEqual({ tipo: "processando" });
    const p = await consultarRecibo(conexao, "511000012345678", nfe.chave);
    expect(p.tipo === "protocolo" && p.protocolo.cStat).toBe("100");
  });

  it("consulta pela chave, status do serviço e eventos (cancelamento e carta de correção)", async () => {
    const nfe = nfeAssinada(vendaMilho, chaves);
    const s = await consultarNota(conexao, nfe.chave);
    expect(s.cStat).toBe("100");
    expect(s.protocolo?.protocolo).toBe("151260000012345");
    expect((await statusServico(conexao)).cStat).toBe("107");

    const canc = eventoCancelamento(
      { ambiente: "homologacao", uf: "MT", chave: nfe.chave, documento: "11444777000161", quando: new Date("2026-10-20T15:00:00Z"), protocolo: "151260000012345", justificativa: "Venda desfeita a pedido do cliente" },
      chaves,
    );
    const rc = await enviarEvento(conexao, canc.xml, "5");
    expect(rc).toMatchObject({ cStat: "135", protocolo: "151260000099999" });
    expect(recebidos.at(-1)!.acao).toBe("http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento");
    const cce = eventoCartaCorrecao(
      { ambiente: "homologacao", uf: "MT", chave: nfe.chave, documento: "11444777000161", quando: new Date("2026-10-20T15:00:00Z"), sequencia: 2, correcao: "Placa do veículo correta: ABC1D23 – motorista João" },
      chaves,
    );
    expect(cce.id).toBe(`ID110110${nfe.chave}02`);
    const rcce = await enviarEvento(conexao, cce.xml, "6");
    expect(rcce.cStat).toBe("135");
    if (temXmllint) {
      expect(validar(canc.xml, "tests/fixtures/nfe-xsd-evento-canc", "eventoCancNFe_v1.00.xsd")).toBe("ok");
      expect(validar(cce.xml, "tests/fixtures/nfe-xsd-evento-cce", "CCe_v1.00.xsd")).toBe("ok");
      expect(validar(montarProcEvento(canc.xml, rc.xml!), "tests/fixtures/nfe-xsd-evento-canc", "procEventoCancNFe_v1.00.xsd")).toBe("ok");
    }
  });
});
