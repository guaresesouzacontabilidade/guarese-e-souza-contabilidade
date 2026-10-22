import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { CHAVE_NFE_MILHO } from "./apoio/cte-ficticio";

/**
 * Emissão de CT-e de ponta a ponta contra o Supabase local e um servidor
 * local que faz o papel da SEFAZ (SOAP 1.2, TLS com certificado do cliente,
 * CT-e compactado em GZip/Base64). Os dados do CT-e são montados pela função
 * do banco (regras da operação do frete) e consumidos pelo emissor. Cria uma
 * transportadora de teste e apaga tudo no fim. Dados FICTÍCIOS.
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

describe.skipIf(!local)("CT-e — emissão de ponta a ponta (Supabase local)", () => {
  const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, { auth: { persistSession: false } });
  const CNPJ = cnpjSorteado();
  let empresaId = "";
  let operacaoId = "";
  let remetenteId = "";
  let destinatarioId = "";
  let servidor: https.Server;
  let base = "";
  let ac: ReturnType<typeof cert>;
  let certificadoEmpresa = "";
  let chaveAnterior: string | undefined;
  let modo: "autoriza" | "rejeita" | "erro500" = "autoriza";
  const recebidas: { url: string; corpo: string }[] = [];
  const autorizadas = new Set<string>();
  const NS = 'xmlns="http://www.portalfiscal.inf.br/cte"';

  const soap = (corpo: string) =>
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><cteRecepcaoResult>${corpo}</cteRecepcaoResult></soap:Body></soap:Envelope>`;
  const prot = (chave: string, cStat: string, xMotivo: string) =>
    `<protCTe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><chCTe>${chave}</chCTe><dhRecbto>2026-10-20T10:00:05-04:00</dhRecbto>` +
    `${cStat === "100" ? "<nProt>151260000054321</nProt><digVal>qjK4Sg+MZ5rgk1kZ8qCw3GQXy5o=</digVal>" : ""}<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protCTe>`;

  beforeAll(async () => {
    chaveAnterior = process.env.CERTIFICADOS_CHAVE;
    process.env.CERTIFICADOS_CHAVE = randomBytes(32).toString("base64");
    const { cifrar } = await import("@/lib/notas-automaticas/cripto");
    const pAc = par();
    ac = cert(pAc, "AC TESTE LOCAL");
    const pEmp = par();
    const titular = `TRANSPORTADORA TESTE CTE LTDA:${CNPJ}`;
    const cEmp = cert(pEmp, titular, { p: pAc, c: ac.c });
    certificadoEmpresa = cEmp.pem;
    const pSrv = par();
    const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");

    const { data: emp, error } = await admin
      .from("empresas")
      .insert({ razao_social: "Transportadora Teste CT-e Ltda", tipo_pessoa: "PJ", documento: CNPJ, regime_tributario: "lucro_presumido", uf: "MT", municipio_ibge: "5100201" })
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
        impressao_digital: "C".repeat(64),
        valido_de: new Date(Date.now() - 86_400_000).toISOString(),
        valido_ate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        autorizacao: "autorizacao_escrita",
        autorizacao_texto: "Teste automático de integração (CT-e).",
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
    const emitenteId = await ins("nfe_emitentes", {
      empresa_id: empresaId,
      nome: "Matriz",
      inscricao_estadual: "137654321",
      logradouro: "Rodovia BR-158",
      numero: "KM 12",
      bairro: "Distrito Industrial",
      municipio_ibge: "5100201",
      cep: "78635000",
      serie: 1,
    });
    const { error: e2 } = await admin.from("cte_config").insert({
      empresa_id: empresaId,
      ativa: true,
      ambiente: "homologacao",
      crt: 3,
      emitente_id: emitenteId,
      rntrc: "12345678",
      informacoes_padrao: "Transporte rodoviário de cargas.",
      autorizacao_texto: "Teste automático de integração (CT-e).",
      autorizado_em: new Date().toISOString(),
    });
    if (e2) throw e2;
    operacaoId = await ins("cte_operacoes", {
      empresa_id: empresaId,
      nome: "Frete de grãos para outro estado",
      natureza: "Prestação de serviço de transporte",
      destino: "interestadual",
      cfop: "6353",
      icms_cst: "00",
      icms_aliquota: 12,
      ibscbs_cclass_trib: "000001",
      informacoes: "ICMS do frete recolhido pelo transportador.",
    });
    remetenteId = await ins("nfe_destinatarios", {
      empresa_id: empresaId,
      tipo: "cnpj",
      documento: "11444777000161",
      nome: "Fazenda Exemplo Grãos Ltda",
      indicador_ie: 1,
      inscricao_estadual: "131234567",
      logradouro: "Estrada Vicinal",
      numero: "SN",
      bairro: "Zona Rural",
      municipio_ibge: "5100201",
      cep: "78635000",
    });
    destinatarioId = await ins("nfe_destinatarios", {
      empresa_id: empresaId,
      tipo: "cnpj",
      documento: "66223344000178",
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
        if (req.url === "/recepcao") {
          const xml = gunzipSync(Buffer.from(/<cteDadosMsg[^>]*>([^<]+)</.exec(corpo)![1], "base64")).toString("utf8");
          recebidas.push({ url: req.url, corpo: xml });
          const chave = /Id="CTe(\d{44})"/.exec(xml)![1];
          if (modo === "erro500") {
            autorizadas.add(chave);
            res.writeHead(500);
            return res.end("erro interno");
          }
          res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
          const cab = "<tpAmb>2</tpAmb><cUF>51</cUF><verAplic>MT_TESTE</verAplic>";
          if (modo === "rejeita") {
            return res.end(soap(`<retCTe ${NS} versao="4.00">${cab}<cStat>539</cStat><xMotivo>x</xMotivo>${prot(chave, "245", "Rejeicao: CNPJ Emitente nao cadastrado")}</retCTe>`));
          }
          autorizadas.add(chave);
          return res.end(soap(`<retCTe ${NS} versao="4.00">${cab}<cStat>100</cStat><xMotivo>Autorizado o uso do CT-e</xMotivo>${prot(chave, "100", "Autorizado o uso do CT-e")}</retCTe>`));
        }
        recebidas.push({ url: req.url ?? "", corpo });
        res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" });
        const chave = /<chCTe>(\d{44})<\/chCTe>/.exec(corpo)?.[1] ?? "";
        if (req.url === "/consulta") {
          const ok = autorizadas.has(chave);
          return res.end(
            soap(
              `<retConsSitCTe ${NS} versao="4.00"><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><cStat>${ok ? "100" : "217"}</cStat>` +
                `<xMotivo>${ok ? "Autorizado o uso do CT-e" : "Rejeicao: CT-e nao consta na base de dados da SEFAZ"}</xMotivo><cUF>51</cUF>${ok ? prot(chave, "100", "Autorizado o uso do CT-e") : ""}</retConsSitCTe>`,
            ),
          );
        }
        if (req.url === "/evento") {
          const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(corpo)![1];
          const seq = /<nSeqEvento>(\d+)<\/nSeqEvento>/.exec(corpo)![1];
          return res.end(
            soap(
              `<retEventoCTe ${NS} versao="4.00"><infEvento><tpAmb>2</tpAmb><verAplic>MT_TESTE</verAplic><cOrgao>51</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a CT-e</xMotivo>` +
                `<chCTe>${chave}</chCTe><tpEvento>${tp}</tpEvento><xEvento>${tp === "110111" ? "Cancelamento" : "Carta de Correcao"}</xEvento><nSeqEvento>${seq}</nSeqEvento>` +
                "<dhRegEvento>2026-10-21T11:00:00-04:00</dhRegEvento><nProt>151260000099999</nProt></infEvento></retEventoCTe>",
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
      await admin.from("cte_emissoes").delete().eq("empresa_id", empresaId);
      await admin.from("cte_config").delete().eq("empresa_id", empresaId);
      await admin.from("empresas").delete().eq("id", empresaId);
    }
    process.env.CERTIFICADOS_CHAVE = chaveAnterior;
  }, 60_000);

  let numero = 0;
  /** Monta os dados com a função do banco (as regras vêm da operação do frete) e registra o CT-e como o pedido faria. */
  async function conhecimento(extra: Record<string, unknown> = {}) {
    const pedido = {
      operacao_id: operacaoId,
      tomador: "destinatario",
      remetente_id: remetenteId,
      destinatario_id: destinatarioId,
      valor_prestacao: "4500.00",
      componentes: [
        { nome: "Frete peso", valor: "4000.00" },
        { nome: "Pedágio", valor: "500.00" },
      ],
      carga: { produto: "MILHO EM GRAOS", peso_kg: "30000", valor: "34500.00", outras: "A GRANEL" },
      nfes: [CHAVE_NFE_MILHO],
      observacoes: "Ordem de carregamento 12.",
      ...extra,
    };
    const sql = `select app.cte_montar_dados('${empresaId}', '${JSON.stringify(pedido).replace(/'/g, "''")}'::jsonb)`;
    const dados = JSON.parse(execFileSync("psql", [DB_URL, "-X", "-A", "-t", "-c", sql], { encoding: "utf8" }).trim()) as Record<string, unknown>;
    const resumo = dados._resumo as Record<string, unknown>;
    delete dados._resumo;
    const { data, error } = await admin
      .from("cte_emissoes")
      .insert({
        empresa_id: empresaId,
        operacao_id: operacaoId,
        ambiente: "homologacao",
        serie: 1,
        numero: ++numero,
        codigo_numerico: String(73519284 + numero),
        pedido: pedido as never,
        dados: dados as never,
        natureza: String(dados.natureza),
        tomador_nome: String(resumo.tomador_nome),
        tomador_documento: String(resumo.tomador_documento),
        uf_inicio: String(resumo.uf_inicio),
        uf_fim: String(resumo.uf_fim),
        municipio_inicio: String(resumo.municipio_inicio),
        municipio_fim: String(resumo.municipio_fim),
        valor_total: Number(resumo.valor_total),
        nfe_chaves: resumo.nfe_chaves as string[],
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const job = (payload: Record<string, unknown>, tentativas = 1) => ({ id: 1, tipo: "emitir_cte", payload, tentativas, max_tentativas: 5 }) as never;

  it("autoriza: CT-e assinado com as regras da operação, cteProc válido no esquema e DACTE", async () => {
    const { emitirCte } = await import("@/lib/cte-emissao/emitir");
    const n = await conhecimento();
    modo = "autoriza";
    const r = (await emitirCte(admin as never, job({ emissao_id: n.id }), { base, ca: [ac.pem] })) as { situacao: string };
    expect(r.situacao).toBe("autorizada");

    const cteXml = recebidas.find((x) => x.url === "/recepcao")!.corpo;
    expect(cteXml).toContain("<CFOP>6353</CFOP>");
    expect(cteXml).toContain("<ICMS00><CST>00</CST><vBC>4500.00</vBC><pICMS>12.00</pICMS><vICMS>540.00</vICMS></ICMS00>");
    expect(cteXml).toContain("<cClassTrib>000001</cClassTrib>");
    expect(cteXml).toContain("<toma3><toma>3</toma></toma3>");
    expect(cteXml).toContain("<Comp><xNome>FRETE PESO</xNome><vComp>4000.00</vComp></Comp><Comp><xNome>PEDÁGIO</xNome><vComp>500.00</vComp></Comp>");
    expect(cteXml).toContain("<RNTRC>12345678</RNTRC>");
    expect(cteXml).toContain("ICMS do frete recolhido pelo transportador. Transporte rodoviário de cargas. Ordem de carregamento 12.");
    const doc = new DOMParser().parseFromString(cteXml, "text/xml");
    const v = new SignedXml({ publicCert: certificadoEmpresa });
    v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0] as unknown as Node);
    expect(v.checkSignature(cteXml)).toBe(true);

    const { data: e } = await admin.from("cte_emissoes").select("*").eq("id", n.id).single();
    expect(e).toMatchObject({ situacao: "autorizada", protocolo: "151260000054321", tentativas: 1, documento_id: null });
    expect(e!.xml_autorizado).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><cteProc/);
    expect((e!.totais as { icms: { vICMS: string } }).icms.vICMS).toBe("540.00");
    const pasta = mkdtempSync(join(tmpdir(), "cte-xsd-"));
    cpSync(resolve("tests/fixtures/cte-xsd-NT2026002"), pasta, { recursive: true });
    writeFileSync(join(pasta, "doc.xml"), e!.xml_autorizado!.replace(/^<\?xml[^>]*\?>/, ""));
    expect(() => execFileSync("xmllint", ["--noout", "--schema", join(pasta, "procCTe_v4.00.xsd"), join(pasta, "doc.xml")], { stdio: "pipe" })).not.toThrow();

    const { gerarDacte } = await import("@/lib/cte-emissao/dacte");
    expect((await gerarDacte(e!.xml_autorizado!)).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("rejeição da SEFAZ fica registrada com o código e o motivo", async () => {
    const { emitirCte } = await import("@/lib/cte-emissao/emitir");
    const n = await conhecimento({ valor_prestacao: "1200.00", componentes: [] });
    modo = "rejeita";
    await emitirCte(admin as never, job({ emissao_id: n.id }), { base, ca: [ac.pem] });
    const { data: e } = await admin.from("cte_emissoes").select("situacao, mensagens").eq("id", n.id).single();
    expect(e).toEqual({ situacao: "rejeitada", mensagens: [{ codigo: "245", descricao: "Rejeicao: CNPJ Emitente nao cadastrado" }] });
  });

  it("sem resposta: volta à fila; a nova tentativa consulta a chave e não envia o CT-e de novo", async () => {
    const { emitirCte } = await import("@/lib/cte-emissao/emitir");
    const n = await conhecimento({ valor_prestacao: "800.00", componentes: [] });
    modo = "erro500";
    await expect(emitirCte(admin as never, job({ emissao_id: n.id }, 1), { base, ca: [ac.pem] })).rejects.toThrow(/HTTP 500/);
    const { data: f } = await admin.from("cte_emissoes").select("situacao, chave, tentativas").eq("id", n.id).single();
    expect(f).toMatchObject({ situacao: "falha", tentativas: 1 });
    const envios = recebidas.filter((x) => x.url === "/recepcao").length;
    modo = "autoriza";
    const r = (await emitirCte(admin as never, job({ emissao_id: n.id }, 2), { base, ca: [ac.pem] })) as { situacao: string; chave: string };
    expect(r.situacao).toBe("autorizada");
    expect(r.chave).toBe(f!.chave);
    expect(recebidas.filter((x) => x.url === "/recepcao").length).toBe(envios);
  });

  it("carta de correção campo a campo e cancelamento registrados", async () => {
    const { eventoCte } = await import("@/lib/cte-emissao/emitir");
    const { data: e } = await admin.from("cte_emissoes").select("id").eq("empresa_id", empresaId).eq("numero", 1).single();
    const { data: cce } = await admin
      .from("cte_eventos")
      .insert({
        emissao_id: e!.id,
        empresa_id: empresaId,
        tipo: "carta_correcao",
        sequencia: 1,
        texto: "Correção de compl/xObs: Placa correta XYZ9A87.",
        correcoes: [{ grupo: "compl", campo: "xObs", valor: "Placa correta XYZ9A87" }],
      })
      .select("id")
      .single();
    const rc = (await eventoCte(admin as never, job({ evento_id: cce!.id }), { base, ca: [ac.pem] })) as { situacao: string };
    expect(rc.situacao).toBe("registrado");
    const enviado = recebidas.filter((x) => x.url === "/evento").at(-1)!.corpo;
    expect(enviado).toContain("<infCorrecao><grupoAlterado>compl</grupoAlterado><campoAlterado>xObs</campoAlterado><valorAlterado>Placa correta XYZ9A87</valorAlterado></infCorrecao>");

    await admin.from("cte_emissoes").update({ situacao: "cancelando" }).eq("id", e!.id);
    const { data: ev } = await admin
      .from("cte_eventos")
      .insert({ emissao_id: e!.id, empresa_id: empresaId, tipo: "cancelamento", sequencia: 1, texto: "Frete desfeito: carga não embarcada" })
      .select("id")
      .single();
    const r = (await eventoCte(admin as never, job({ evento_id: ev!.id }), { base, ca: [ac.pem] })) as { situacao: string };
    expect(r.situacao).toBe("registrado");
    const { data: depois } = await admin.from("cte_emissoes").select("situacao").eq("id", e!.id).single();
    expect(depois!.situacao).toBe("cancelada");
    const { data: evento } = await admin.from("cte_eventos").select("situacao, protocolo, xml").eq("id", ev!.id).single();
    expect(evento).toMatchObject({ situacao: "registrado", protocolo: "151260000099999" });
    expect(evento!.xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><procEventoCTe/);
  });
});
