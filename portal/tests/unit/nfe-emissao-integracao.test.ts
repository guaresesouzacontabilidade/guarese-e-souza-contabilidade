import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

/**
 * Emissão de NF-e de ponta a ponta contra o Supabase local e um servidor
 * local que faz o papel da SEFAZ (SOAP 1.2, TLS com certificado do cliente).
 * Os dados da nota são montados pela função do banco (regras da operação) e
 * consumidos pelo emissor. Cria uma empresa de teste e apaga tudo no fim.
 * Notas FICTÍCIAS.
 */
function carregarEnv() {
  if (!existsSync(".env.local")) return;
  for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
carregarEnv();
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const CHAVE_SECRETA = process.env.SUPABASE_SECRET_KEY ?? "";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const temPsql = (() => {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const local = /127\.0\.0\.1|localhost/.test(URL_SUPABASE) && Boolean(CHAVE_SECRETA) && temPsql;

/** CNPJ válido sorteado (empresa de teste) */
function cnpjSorteado() {
  const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (n: number[]) => {
    const pesos = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = n.reduce((a, x, i) => a + x * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(b);
  const d2 = dv([...b, d1]);
  return [...b, d1, d2].join("");
}

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
  c.validity.notAfter = new Date(Date.now() + 200 * 86_400_000);
  const sujeito = [{ name: "commonName", value: cn }];
  c.setSubject(sujeito);
  c.setIssuer(emissor ? emissor.c.subject.attributes : sujeito);
  c.setExtensions([{ name: "basicConstraints", cA: !emissor }, ...(dns ? [{ name: "subjectAltName", altNames: [{ type: 2, value: dns }] }] : [])]);
  c.sign(emissor?.p.k ?? p.k, forge.md.sha256.create());
  return { c, pem: forge.pki.certificateToPem(c) };
}

describe.skipIf(!local)("NF-e — emissão de ponta a ponta (Supabase local)", () => {
  const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, { auth: { persistSession: false } });
  const CNPJ = cnpjSorteado();
  let empresaId = "";
  let emitenteId = "";
  let operacaoId = "";
  let produtoId = "";
  let clienteId = "";
  let servidor: https.Server;
  let base = "";
  let ac: ReturnType<typeof cert>;
  let certificadoEmpresa = "";
  let chaveAnterior: string | undefined;
  let modo: "autoriza" | "rejeita" | "erro500" | "ja_autorizada" = "autoriza";
  const recebidas: { url: string; corpo: string }[] = [];
  const autorizadas = new Map<string, string>();

  const soap = (corpo: string) =>
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`;
  const prot = (chave: string, cStat: string, xMotivo: string) =>
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>` +
    `${cStat === "100" ? "<nProt>151260000054321</nProt><digVal>qjK4Sg+MZ5rgk1kZ8qCw3GQXy5o=</digVal>" : ""}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
  const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';

  beforeAll(async () => {
    chaveAnterior = process.env.CERTIFICADOS_CHAVE;
    process.env.CERTIFICADOS_CHAVE = randomBytes(32).toString("base64");
    const { cifrar } = await import("@/lib/notas-automaticas/cripto");
    const pAc = par();
    ac = cert(pAc, "AC TESTE LOCAL");
    const pEmp = par();
    const titular = `AGRO TESTE NFE LTDA:${CNPJ}`;
    const cEmp = cert(pEmp, titular, { p: pAc, c: ac.c });
    certificadoEmpresa = cEmp.pem;
    const pSrv = par();
    const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");

    const { data: emp, error } = await admin
      .from("empresas")
      .insert({ razao_social: "Agro Teste NF-e Ltda", tipo_pessoa: "PJ", documento: CNPJ, regime_tributario: "lucro_real", uf: "MT", municipio_ibge: "5100201" })
      .select("id")
      .single();
    if (error) throw error;
    empresaId = emp.id;
    const { data: c, error: e1 } = await admin
      .from("certificados_digitais")
      .insert({
        empresa_id: empresaId,
        titular,
        documento: CNPJ,
        impressao_digital: "E".repeat(64),
        valido_de: new Date(Date.now() - 86_400_000).toISOString(),
        valido_ate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        autorizacao: "autorizacao_escrita",
        autorizacao_texto: "Teste automático de integração (NF-e).",
      })
      .select("id")
      .single();
    if (e1) throw e1;
    await admin.from("certificados_segredos").insert({ certificado_id: c.id, conteudo_cifrado: cifrar(JSON.stringify({ chave: pEmp.pem, certificados: [cEmp.pem] })) });
    const ins = async (tabela: string, dados: Record<string, unknown>) => {
      const { data, error: e } = await admin.from(tabela as never).insert(dados as never).select("id").single();
      if (e) throw new Error(`${tabela}: ${e.message}`);
      return (data as { id: string }).id;
    };
    await admin.from("nfe_config").insert({
      empresa_id: empresaId,
      ativa: true,
      ambiente: "homologacao",
      crt: 3,
      autorizacao_texto: "Teste automático de integração (NF-e).",
      autorizado_em: new Date().toISOString(),
      enviar_email_destinatario: false,
    });
    emitenteId = await ins("nfe_emitentes", {
      empresa_id: empresaId,
      nome: "Matriz",
      inscricao_estadual: "131234567",
      logradouro: "Rodovia BR-158",
      numero: "KM 10",
      bairro: "Zona Rural",
      municipio_ibge: "5100201",
      cep: "78635000",
      serie: 1,
    });
    operacaoId = await ins("nfe_operacoes", {
      empresa_id: empresaId,
      nome: "Venda de milho para outro estado",
      natureza: "Venda de mercadoria",
      destino: "interestadual",
      cfop: "6102",
      icms_cst: "00",
      icms_aliquota: 12,
      pis_cst: "01",
      pis_aliquota: 1.65,
      cofins_cst: "01",
      cofins_aliquota: 7.6,
      ibscbs_cclass_trib: "200036",
      icms_por_operacao: true,
      icms_codigo_receita: "1112",
      frete_icms_retido: true,
      frete_aliquota: 12,
      frete_reducao: 20,
      frete_cfop: "6360",
      contribuicoes: [{ nome: "FETHAB", tipo: "upf_por_tonelada", valor: 10, valorUpf: 250.5, ncms: ["1005"], codigoReceita: "5005" }],
      informacoes: "ICMS recolhido antes da saída (RICMS/MT, art. 132).",
    });
    produtoId = await ins("nfe_produtos", { empresa_id: empresaId, codigo: "MILHO", descricao: "Milho em grãos", ncm: "10059010", unidade: "KG", peso_kg: 1 });
    clienteId = await ins("nfe_destinatarios", {
      empresa_id: empresaId,
      tipo: "cnpj",
      documento: "12345678000195",
      nome: "Granja Exemplo S.A.",
      indicador_ie: 1,
      inscricao_estadual: "101234567",
      logradouro: "Avenida Presidente Vargas",
      numero: "100",
      bairro: "Centro",
      municipio_ibge: "5218805",
      cep: "75901000",
    });

    servidor = https.createServer({ key: pSrv.pem, cert: cSrv.pem, ca: [ac.pem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let corpo = "";
      req.on("data", (b) => (corpo += b));
      req.on("end", () => {
        recebidas.push({ url: req.url ?? "", corpo });
        if (!(req.url === "/autorizacao" && modo === "erro500")) res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
        const cab = "<tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic>";
        if (req.url === "/autorizacao") {
          const chave = /Id="NFe(\d{44})"/.exec(corpo)![1];
          if (modo === "erro500") {
            autorizadas.set(chave, corpo);
            res.writeHead(500);
            return res.end("erro interno");
          }
          if (modo === "rejeita") {
            return res.end(soap(`<retEnviNFe ${NS} versao="4.00">${cab}<cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>${prot(chave, "233", "Rejeição: IE do destinatário não cadastrada")}</retEnviNFe>`));
          }
          autorizadas.set(chave, corpo);
          return res.end(soap(`<retEnviNFe ${NS} versao="4.00">${cab}<cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>${prot(chave, "100", "Autorizado o uso da NF-e")}</retEnviNFe>`));
        }
        if (req.url === "/consulta") {
          const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(corpo)![1];
          if (autorizadas.has(chave)) {
            return res.end(soap(`<retConsSitNFe ${NS} versao="4.00">${cab}<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:01:00-04:00</dhRecbto><chNFe>${chave}</chNFe>${prot(chave, "100", "Autorizado o uso da NF-e")}</retConsSitNFe>`));
          }
          return res.end(soap(`<retConsSitNFe ${NS} versao="4.00">${cab}<cStat>217</cStat><xMotivo>Rejeição: NF-e não consta na base de dados da SEFAZ</xMotivo><cUF>51</cUF><dhRecbto>2026-10-20T10:01:00-04:00</dhRecbto><chNFe>${chave}</chNFe></retConsSitNFe>`));
        }
        if (req.url === "/evento") {
          const chave = /<chNFe>(\d{44})<\/chNFe>/.exec(corpo)![1];
          const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(corpo)![1];
          return res.end(
            soap(
              `<retEnvEvento ${NS} versao="1.00"><idLote>1</idLote>${cab}<cOrgao>51</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
                `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><cOrgao>51</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>` +
                `<chNFe>${chave}</chNFe><tpEvento>${tp}</tpEvento><xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-20T11:00:00-04:00</dhRegEvento><nProt>151260000099999</nProt></infEvento></retEvento></retEnvEvento>`,
            ),
          );
        }
        res.end("?");
      });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    base = `https://localhost:${(servidor.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    servidor?.close();
    if (empresaId) {
      await admin.from("jobs").delete().eq("empresa_id", empresaId);
      await admin.from("notificacoes").delete().eq("empresa_id", empresaId);
      await admin.from("nfe_emissoes").delete().eq("empresa_id", empresaId);
      await admin.from("empresas").delete().eq("id", empresaId);
    }
    process.env.CERTIFICADOS_CHAVE = chaveAnterior;
  }, 60_000);

  let numero = 0;
  /** Monta os dados com a função do banco (as regras vêm da operação) e registra a nota como o pedido faria. */
  async function nota(extra: Record<string, unknown> = {}) {
    const pedido = {
      emitente_id: emitenteId,
      operacao_id: operacaoId,
      destinatario_id: clienteId,
      itens: [{ produto_id: produtoId, quantidade: "30000", valor_unitario: "1.15" }],
      transporte: { modalidade: 0, frete_servico: "4500", placa: "ABC1D23", placa_uf: "MT", especie: "GRANEL" },
      pagamento: { forma: "15", a_prazo: true, parcelas: [{ vencimento: "2026-11-20", valor: "34500.00" }] },
      ...extra,
    };
    const sql = `select app.nfe_montar_dados('${empresaId}', '${JSON.stringify(pedido).replace(/'/g, "''")}'::jsonb)`;
    const dados = JSON.parse(execFileSync("psql", [DB_URL, "-X", "-A", "-t", "-c", sql], { encoding: "utf8" }).trim()) as Record<string, unknown>;
    const resumo = dados._resumo as Record<string, unknown>;
    delete dados._resumo;
    const { data, error } = await admin
      .from("nfe_emissoes")
      .insert({
        empresa_id: empresaId,
        emitente_id: emitenteId,
        operacao_id: operacaoId,
        destinatario_id: clienteId,
        ambiente: "homologacao",
        serie: 1,
        numero: ++numero,
        codigo_numerico: String(48213765 + numero),
        pedido: pedido as never,
        dados: dados as never,
        natureza: String(dados.natureza),
        destinatario_nome: String(resumo.destinatario_nome),
        destinatario_documento: String(resumo.destinatario_documento),
        destinatario_uf: String(resumo.destinatario_uf),
        valor_total: Number(resumo.valor_total),
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const job = (payload: Record<string, unknown>, tentativas = 1) => ({ id: 1, tipo: "emitir_nfe", payload, tentativas, max_tentativas: 5 }) as never;

  it("autoriza: NF-e assinada com as regras da operação, nfeProc válido e guias com os valores da nota", async () => {
    const { emitirNfe } = await import("@/lib/nfe-emissao/emitir");
    const n = await nota();
    modo = "autoriza";
    const r = (await emitirNfe(admin as never, job({ emissao_id: n.id }), { base, ca: [ac.pem] })) as { situacao: string };
    expect(r.situacao).toBe("autorizada");

    const envio = recebidas.find((x) => x.url === "/autorizacao")!.corpo;
    const nfeXml = /<NFe [\s\S]*<\/NFe>/.exec(envio)![0];
    expect(nfeXml).toContain("<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>34500.00</vBC><pICMS>12.00</pICMS><vICMS>4140.00</vICMS></ICMS00>");
    expect(nfeXml).toContain("<cClassTrib>200036</cClassTrib>");
    expect(nfeXml).toContain("<retTransp><vServ>4500.00</vServ><vBCRet>3600.00</vBCRet>");
    expect(nfeXml).toContain("ICMS recolhido antes da saída (RICMS/MT, art. 132).");
    expect(nfeXml).toContain("<qCom>30000</qCom><vUnCom>1.15</vUnCom>");
    expect(nfeXml).toContain("<vol><esp>GRANEL</esp><pesoL>30000.000</pesoL><pesoB>30000.000</pesoB></vol>");
    const doc = new DOMParser().parseFromString(nfeXml, "text/xml");
    const v = new SignedXml({ publicCert: certificadoEmpresa });
    v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0] as unknown as Node);
    expect(v.checkSignature(nfeXml)).toBe(true);

    const { data: e } = await admin.from("nfe_emissoes").select("*").eq("id", n.id).single();
    expect(e).toMatchObject({ situacao: "autorizada", protocolo: "151260000054321", tentativas: 1, documento_id: null });
    expect(e!.xml_autorizado).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><nfeProc/);
    expect((e!.totais as Record<string, unknown>).vICMS).toBe("4140.00");
    // nfeProc no esquema oficial
    const pasta = mkdtempSync(join(tmpdir(), "nfe-xsd-"));
    cpSync(resolve("tests/fixtures/nfe-xsd-PL010f"), pasta, { recursive: true });
    writeFileSync(
      join(pasta, "proc.xsd"),
      '<?xml version="1.0" encoding="UTF-8"?><xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="http://www.portalfiscal.inf.br/nfe" targetNamespace="http://www.portalfiscal.inf.br/nfe" elementFormDefault="qualified" attributeFormDefault="unqualified"><xs:include schemaLocation="leiauteNFe_v4.00.xsd"/><xs:element name="nfeProc" type="TNfeProc"/></xs:schema>',
    );
    writeFileSync(join(pasta, "doc.xml"), e!.xml_autorizado!);
    expect(() => execFileSync("xmllint", ["--noout", "--schema", join(pasta, "proc.xsd"), join(pasta, "doc.xml")], { stdio: "pipe" })).not.toThrow();

    const { data: guias } = await admin.from("nfe_guias").select("tipo, uf, valor, codigo_receita, situacao").eq("emissao_id", n.id).order("tipo");
    expect(guias).toEqual([
      { tipo: "contribuicao", uf: "MT", valor: 751.5, codigo_receita: "5005", situacao: "a_gerar" },
      { tipo: "icms_frete", uf: "MT", valor: 432, codigo_receita: null, situacao: "a_gerar" },
      { tipo: "icms_operacao", uf: "MT", valor: 4140, codigo_receita: "1112", situacao: "a_gerar" },
    ]);

    const { gerarDanfe } = await import("@/lib/nfe-emissao/danfe");
    const pdf = await gerarDanfe(e!.xml_autorizado!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("rejeição da SEFAZ fica registrada com o código e o motivo", async () => {
    const { emitirNfe } = await import("@/lib/nfe-emissao/emitir");
    const n = await nota({ itens: [{ produto_id: produtoId, quantidade: "1000", valor_unitario: "1.20" }], pagamento: { forma: "17" } });
    modo = "rejeita";
    await emitirNfe(admin as never, job({ emissao_id: n.id }), { base, ca: [ac.pem] });
    const { data: e } = await admin.from("nfe_emissoes").select("situacao, mensagens").eq("id", n.id).single();
    expect(e).toEqual({ situacao: "rejeitada", mensagens: [{ codigo: "233", descricao: "Rejeição: IE do destinatário não cadastrada" }] });
  });

  it("sem resposta: volta à fila; a nova tentativa consulta a chave e não envia a nota de novo", async () => {
    const { emitirNfe } = await import("@/lib/nfe-emissao/emitir");
    const n = await nota({ itens: [{ produto_id: produtoId, quantidade: "500", valor_unitario: "1.30" }], pagamento: { forma: "17" } });
    modo = "erro500";
    await expect(emitirNfe(admin as never, job({ emissao_id: n.id }, 1), { base, ca: [ac.pem] })).rejects.toThrow(/HTTP 500/);
    const { data: f } = await admin.from("nfe_emissoes").select("situacao, chave, tentativas").eq("id", n.id).single();
    expect(f).toMatchObject({ situacao: "falha", tentativas: 1 });
    const envios = recebidas.filter((x) => x.url === "/autorizacao").length;
    modo = "autoriza";
    const r = (await emitirNfe(admin as never, job({ emissao_id: n.id }, 2), { base, ca: [ac.pem] })) as { situacao: string; chave: string };
    expect(r.situacao).toBe("autorizada");
    expect(r.chave).toBe(f!.chave);
    expect(recebidas.filter((x) => x.url === "/autorizacao").length).toBe(envios);
  });

  it("cancelamento registrado: nota cancelada e guias ainda não geradas dispensadas", async () => {
    const { eventoNfe } = await import("@/lib/nfe-emissao/emitir");
    const { data: e } = await admin.from("nfe_emissoes").select("id").eq("empresa_id", empresaId).eq("numero", 1).single();
    await admin.from("nfe_emissoes").update({ situacao: "cancelando" }).eq("id", e!.id);
    const { data: ev } = await admin
      .from("nfe_eventos")
      .insert({ emissao_id: e!.id, empresa_id: empresaId, tipo: "cancelamento", sequencia: 1, texto: "Venda desfeita a pedido do cliente" })
      .select("id")
      .single();
    const r = (await eventoNfe(admin as never, job({ evento_id: ev!.id }), { base, ca: [ac.pem] })) as { situacao: string };
    expect(r.situacao).toBe("registrado");
    const { data: depois } = await admin.from("nfe_emissoes").select("situacao").eq("id", e!.id).single();
    expect(depois!.situacao).toBe("cancelada");
    const { data: evento } = await admin.from("nfe_eventos").select("situacao, protocolo, xml").eq("id", ev!.id).single();
    expect(evento).toMatchObject({ situacao: "registrado", protocolo: "151260000099999" });
    expect(evento!.xml).toContain("<procEventoNFe");
    const { data: guias } = await admin.from("nfe_guias").select("situacao").eq("emissao_id", e!.id);
    expect(guias!.every((g) => g.situacao === "dispensada")).toBe(true);
  });
});
