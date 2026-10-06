import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import { readFileSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

/**
 * Busca automática de ponta a ponta contra o Supabase local e um servidor
 * local que faz o papel da SEFAZ e do Ambiente Nacional (TLS com certificado
 * do cliente). Só roda quando o Supabase local está configurado (.env.local);
 * usa a empresa de demonstração "Padaria" (CNPJ fictício dos XML de teste) e
 * apaga tudo o que criou no fim.
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
const local = /127\.0\.0\.1|localhost/.test(URL_SUPABASE) && Boolean(CHAVE_SECRETA);

const CNPJ = "11222333000181";
const CHAVE_RESUMO = "17260955566677000188550010000099991000099991";
const CHAVE_NFE = "17260998765432000198550010000004561876543215";
const fixture = (nome: string) => readFileSync(`tests/fixtures/${nome}`, "utf8");
const zip = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");

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

describe.skipIf(!local)("notas automáticas — busca de ponta a ponta (Supabase local)", () => {
  const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, { auth: { persistSession: false } });
  let empresaId = "";
  let certificadoId = "";
  let servidor: https.Server;
  let base = "";
  let ac: ReturnType<typeof cert>;
  const eventosRecebidos: string[] = [];
  let consultasDist = 0;
  const criados: string[] = [];
  let chaveAnterior: string | undefined;

  beforeAll(async () => {
    const { data: emp } = await admin.from("empresas").select("id").eq("documento", CNPJ).maybeSingle();
    if (!emp) throw new Error("Rode `npm run seed:demo` (empresa fictícia com o CNPJ dos XML de teste).");
    empresaId = emp.id;
    await limpar();

    chaveAnterior = process.env.CERTIFICADOS_CHAVE;
    process.env.CERTIFICADOS_CHAVE = randomBytes(32).toString("base64");
    const { cifrar } = await import("@/lib/notas-automaticas/cripto");
    const pAc = par();
    ac = cert(pAc, "AC TESTE LOCAL");
    const pEmp = par();
    const cEmp = cert(pEmp, `PADARIA (DEMO):${CNPJ}`, { p: pAc, c: ac.c });
    const pSrv = par();
    const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");

    const { data: c, error } = await admin
      .from("certificados_digitais")
      .insert({
        empresa_id: empresaId,
        titular: `PADARIA (DEMO):${CNPJ}`,
        documento: CNPJ,
        impressao_digital: "A".repeat(64),
        valido_de: new Date(Date.now() - 86_400_000).toISOString(),
        valido_ate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        autorizacao: "autorizacao_escrita",
        autorizacao_texto: "Teste automático de integração.",
      })
      .select("id")
      .single();
    if (error) throw error;
    certificadoId = c.id;
    await admin.from("certificados_segredos").insert({ certificado_id: certificadoId, conteudo_cifrado: cifrar(JSON.stringify({ chave: pEmp.pem, certificados: [cEmp.pem] })) });
    // Sem mês inicial: os XML de teste são de setembro/2026 (o padrão seria o mês anterior ao de hoje)
    await admin.from("notas_automaticas").insert({ empresa_id: empresaId, ciencia_automatica: true, buscar_desde: null });

    servidor = https.createServer({ key: pSrv.pem, cert: cSrv.pem, ca: [ac.pem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let corpo = "";
      req.on("data", (b) => (corpo += b));
      req.on("end", () => {
        const cn = (req.socket as import("node:tls").TLSSocket).getPeerCertificate().subject?.CN;
        if (cn !== `PADARIA (DEMO):${CNPJ}`) {
          res.writeHead(403).end();
          return;
        }
        if (req.url === "/dist") {
          consultasDist++;
          const ult = /<ultNSU>(\d+)<\/ultNSU>/.exec(corpo)?.[1];
          const resumo =
            `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${CHAVE_RESUMO}</chNFe><CNPJ>55566677000188</CNPJ>` +
            "<xNome>FORNECEDOR RESUMO (FICTICIO)</xNome><IE>1</IE><dhEmi>2026-09-29T09:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>321.09</vNF>" +
            "<digVal>x</digVal><dhRecbto>2026-09-29T09:00:01-03:00</dhRecbto><nProt>1</nProt><cSitNFe>1</cSitNFe></resNFe>";
          const ret =
            ult === "000000000000000"
              ? '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>T</verAplic><cStat>138</cStat><xMotivo>Documento localizado</xMotivo>' +
                "<dhResp>2026-10-02T10:00:00-03:00</dhResp><ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU><loteDistDFeInt>" +
                `<docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${zip(resumo)}</docZip>` +
                `<docZip NSU="000000000000002" schema="procNFe_v4.00.xsd">${zip(fixture("nfe-entrada.xml"))}</docZip></loteDistDFeInt></retDistDFeInt>`
              : '<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>T</verAplic><cStat>137</cStat><xMotivo>Nenhum documento localizado</xMotivo>' +
                `<dhResp>2026-10-02T10:00:00-03:00</dhResp><ultNSU>${ult}</ultNSU><maxNSU>${ult}</maxNSU></retDistDFeInt>`;
          res.writeHead(200, { "Content-Type": "application/soap+xml" });
          res.end(`<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult>${ret}</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`);
          return;
        }
        if (req.url === "/evento") {
          eventosRecebidos.push(corpo);
          const chaves = [...corpo.matchAll(/<chNFe>(\d{44})<\/chNFe>/g)].map((m) => m[1]);
          const rets = chaves
            .map((ch) => `<retEvento versao="1.00"><infEvento><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${ch}</chNFe><nProt>9</nProt></infEvento></retEvento>`)
            .join("");
          res.writeHead(200, { "Content-Type": "application/soap+xml" });
          res.end(`<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg><retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo>${rets}</retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`);
          return;
        }
        if (req.url?.startsWith("/nfse/DFe/")) {
          const nsu = Number(/DFe\/(\d+)/.exec(req.url)?.[1]);
          res.writeHead(nsu <= 1 ? 200 : 404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              nsu <= 1
                ? { StatusProcessamento: "DOCUMENTOS_LOCALIZADOS", LoteDFe: [{ NSU: 1, ChaveAcesso: "X", TipoDocumento: "NFSE", ArquivoXml: zip(fixture("nfse-nacional.xml")) }] }
                : { StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO", LoteDFe: [] },
            ),
          );
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    base = `https://localhost:${(servidor.address() as AddressInfo).port}`;
  }, 60_000);

  async function limpar() {
    const { data: docs } = await admin.from("documentos").select("id, storage_path").eq("empresa_id", empresaId).eq("origem", "automatica");
    if (docs?.length) {
      const ids = docs.map((d) => d.id);
      const { data: fiscais } = await admin.from("documentos_fiscais").select("id").in("documento_id", ids);
      const idsFiscais = (fiscais ?? []).map((f) => f.id);
      const passos = [
        () => admin.from("lancamentos").delete().in("documento_fiscal_id", idsFiscais.length ? idsFiscais : ["00000000-0000-0000-0000-000000000000"]),
        () => admin.from("documento_fiscal_eventos").delete().in("documento_id", ids),
        () => admin.from("documentos_fiscais").delete().in("documento_id", ids),
        () => admin.from("documentos").delete().in("id", ids),
      ];
      for (const passo of passos) {
        const { error } = await passo();
        if (error) throw new Error(`Limpeza do teste falhou: ${error.message}`);
      }
      await admin.storage.from("documentos").remove(docs.map((d) => d.storage_path).filter(Boolean) as string[]);
    }
    await admin.from("nfe_resumos").delete().eq("empresa_id", empresaId);
    await admin.from("notas_automaticas_nsu").delete().eq("empresa_id", empresaId);
    await admin.from("notas_automaticas_execucoes").delete().eq("empresa_id", empresaId);
    await admin.from("notas_automaticas").delete().eq("empresa_id", empresaId);
    await admin.from("certificados_digitais").delete().eq("empresa_id", empresaId);
    await admin.from("jobs").delete().eq("empresa_id", empresaId).eq("tipo", "notas_automaticas");
  }

  afterAll(async () => {
    servidor?.close();
    if (empresaId) await limpar();
    criados.length = 0;
    process.env.CERTIFICADOS_CHAVE = chaveAnterior;
  }, 60_000);

  it("busca NF-e e NFS-e, guarda resumos, importa os XML, envia a ciência e agenda a próxima busca", async () => {
    const { executarNotasAutomaticas } = await import("@/lib/notas-automaticas/sincronizar");
    const job = { id: 1, tipo: "notas_automaticas", payload: { empresa_id: empresaId } } as never;
    const urls = { distribuicao: `${base}/dist`, evento: `${base}/evento`, nfse: `${base}/nfse` };
    const r = (await executarNotasAutomaticas(admin as never, job, { urls, ca: [ac.pem] })) as { erros: string[]; proxima: string };
    expect(r.erros).toEqual([]);

    // NF-e: resumo guardado, XML completo importado (ou ligado ao que já existia), NSU avançado
    const { data: resumo } = await admin.from("nfe_resumos").select("*").eq("empresa_id", empresaId).eq("chave", CHAVE_RESUMO).single();
    expect(resumo).toMatchObject({ emitente_nome: "FORNECEDOR RESUMO (FICTICIO)", tipo_operacao: "entrada", situacao: "autorizada" });
    expect(Number(resumo!.valor)).toBe(321.09);
    const { data: fiscal } = await admin.from("documentos_fiscais").select("documento_id").eq("empresa_id", empresaId).eq("chave_acesso", CHAVE_NFE);
    expect(fiscal?.length).toBeGreaterThan(0);
    const { data: cfg } = await admin.from("notas_automaticas").select("*").eq("empresa_id", empresaId).single();
    expect(cfg).toMatchObject({ nfe_ult_nsu: "000000000000002", ultimo_erro: null, erros_seguidos: 0, executando_ate: null });
    expect(new Date(cfg!.nfe_proxima!).getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);

    // Ciência: evento assinado enviado para a nota que só tinha resumo, com assinatura válida
    expect(eventosRecebidos).toHaveLength(1);
    const env = /<envEvento[\s\S]*<\/envEvento>/.exec(eventosRecebidos[0])![0];
    expect(env).toContain(`<chNFe>${CHAVE_RESUMO}</chNFe>`);
    expect(env).not.toContain(`<chNFe>${CHAVE_NFE}</chNFe>`);
    const doc = new DOMParser().parseFromString(env, "text/xml");
    const certEnviado = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(env)![1];
    const v = new SignedXml({ publicCert: `-----BEGIN CERTIFICATE-----\n${certEnviado}\n-----END CERTIFICATE-----` });
    v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]);
    expect(v.checkSignature(env)).toBe(true);
    const { data: ciente } = await admin.from("nfe_resumos").select("ciencia_em, ciencia_retorno").eq("empresa_id", empresaId).eq("chave", CHAVE_RESUMO).single();
    expect(ciente?.ciencia_em).not.toBeNull();

    // NFS-e importada do Ambiente Nacional
    expect(Number(cfg!.nfse_ult_nsu)).toBe(1);
    const { data: execucoes } = await admin.from("notas_automaticas_execucoes").select("servico, resultado").eq("empresa_id", empresaId);
    expect(execucoes?.map((e) => `${e.servico}:${e.resultado}`).sort()).toEqual(["ciencia:novos", "nfe:novos", "nfse:novos"]);

    // Próxima busca agendada na fila
    const { data: jobs } = await admin.from("jobs").select("executar_apos").eq("empresa_id", empresaId).eq("tipo", "notas_automaticas").eq("status", "pendente");
    expect(jobs?.length).toBe(1);

    // Segunda execução logo depois: a NF-e respeita a espera de 1 hora (não consulta), e nada é duplicado
    const antes = consultasDist;
    await admin.from("notas_automaticas").update({ nfse_proxima: new Date().toISOString() }).eq("empresa_id", empresaId);
    const r2 = (await executarNotasAutomaticas(admin as never, job, { urls, ca: [ac.pem] })) as { erros: string[] };
    expect(r2.erros).toEqual([]);
    expect(consultasDist).toBe(antes);
    const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("origem", "automatica");
    const { count: nsus } = await admin.from("notas_automaticas_nsu").select("nsu", { count: "exact", head: true }).eq("empresa_id", empresaId);
    expect(nsus).toBe(3);
    expect(count).toBeLessThanOrEqual(2);
  }, 120_000);

  it("certificado não aceito pelo servidor: registra o erro e espaça a próxima tentativa", async () => {
    const { executarNotasAutomaticas } = await import("@/lib/notas-automaticas/sincronizar");
    await admin.from("notas_automaticas").update({ nfe_proxima: null, nfse_proxima: null, executando_ate: null }).eq("empresa_id", empresaId);
    const job = { id: 2, tipo: "notas_automaticas", payload: { empresa_id: empresaId } } as never;
    // Sem a AC local, o certificado do servidor não é confiável: a conexão é recusada (nunca ignorada)
    const r = (await executarNotasAutomaticas(admin as never, job, { urls: { distribuicao: `${base}/dist`, evento: `${base}/evento`, nfse: `${base}/nfse` } })) as {
      erros: string[];
      proxima: string;
    };
    expect(r.erros.length).toBeGreaterThan(0);
    const { data: cfg } = await admin.from("notas_automaticas").select("ultimo_erro, erros_seguidos").eq("empresa_id", empresaId).single();
    expect(cfg?.erros_seguidos).toBe(1);
    expect(cfg?.ultimo_erro).toBeTruthy();
    expect(new Date(r.proxima).getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
  }, 60_000);

  it("mês inicial: ignora as notas anteriores sem guardar nada e, ao recuar o mês, traz de novo as NFS-e", async () => {
    const { executarNotasAutomaticas } = await import("@/lib/notas-automaticas/sincronizar");
    // Recomeça a busca do zero, com o mês inicial em outubro/2026 (os XML de teste são de setembro)
    const { data: docs } = await admin.from("documentos").select("id").eq("empresa_id", empresaId).eq("origem", "automatica");
    const ids = (docs ?? []).map((d) => d.id);
    if (ids.length) {
      const { data: fiscais } = await admin.from("documentos_fiscais").select("id").in("documento_id", ids);
      if (fiscais?.length) await admin.from("lancamentos").delete().in("documento_fiscal_id", fiscais.map((f) => f.id));
      await admin.from("documento_fiscal_eventos").delete().in("documento_id", ids);
      await admin.from("documentos_fiscais").delete().in("documento_id", ids);
      await admin.from("documentos").delete().in("id", ids);
    }
    await admin.from("nfe_resumos").delete().eq("empresa_id", empresaId);
    await admin.from("notas_automaticas_nsu").delete().eq("empresa_id", empresaId);
    await admin.from("notas_automaticas_execucoes").delete().eq("empresa_id", empresaId);
    await admin
      .from("notas_automaticas")
      .update({ buscar_desde: "2026-10-01", nfe_ult_nsu: "000000000000000", nfse_ult_nsu: 0, nfe_proxima: null, nfse_proxima: null, executando_ate: null, erros_seguidos: 0 })
      .eq("empresa_id", empresaId);
    const antesEventos = eventosRecebidos.length;
    const job = { id: 3, tipo: "notas_automaticas", payload: { empresa_id: empresaId } } as never;
    const urls = { distribuicao: `${base}/dist`, evento: `${base}/evento`, nfse: `${base}/nfse` };
    const r = (await executarNotasAutomaticas(admin as never, job, { urls, ca: [ac.pem] })) as { erros: string[] };
    expect(r.erros).toEqual([]);

    // Nada de setembro é guardado: nem XML, nem resumo; os NSU ficam marcados como ignorados, com o mês
    const { count: guardados } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("origem", "automatica");
    expect(guardados).toBe(0);
    const { count: resumos } = await admin.from("nfe_resumos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
    expect(resumos).toBe(0);
    const { data: nsus } = await admin.from("notas_automaticas_nsu").select("servico, nsu, ignorado, competencia, documento_id").eq("empresa_id", empresaId).order("nsu");
    expect(nsus?.map((n) => `${n.servico}:${n.nsu}:${n.ignorado}:${n.competencia}:${n.documento_id}`).sort()).toEqual([
      "nfe:1:true:2026-09-01:null",
      "nfe:2:true:2026-09-01:null",
      "nfse:1:true:2026-09-01:null",
    ]);
    expect(eventosRecebidos.length).toBe(antesEventos); // sem resumo guardado, não há ciência a registrar
    const { data: execucoes } = await admin.from("notas_automaticas_execucoes").select("servico, documentos, ignorados").eq("empresa_id", empresaId);
    expect(execucoes?.map((e) => `${e.servico}:${e.documentos}:${e.ignorados}`).sort()).toEqual(["nfe:0:2", "nfse:0:1"]);
    const { data: cfg } = await admin.from("notas_automaticas").select("nfe_ult_nsu, nfse_ult_nsu").eq("empresa_id", empresaId).single();
    expect(cfg).toMatchObject({ nfe_ult_nsu: "000000000000002", nfse_ult_nsu: 1 });

    // Recuar para setembro (o que definir_inicio_notas faz): a NFS-e ignorada é liberada e a busca volta ao NSU dela
    await admin.from("notas_automaticas_nsu").delete().eq("empresa_id", empresaId).eq("servico", "nfse").eq("ignorado", true);
    await admin.from("notas_automaticas").update({ buscar_desde: "2026-09-01", nfse_ult_nsu: 0, nfse_proxima: new Date().toISOString() }).eq("empresa_id", empresaId);
    const r2 = (await executarNotasAutomaticas(admin as never, job, { urls, ca: [ac.pem] })) as { erros: string[] };
    expect(r2.erros).toEqual([]);
    const { data: depois } = await admin.from("documentos").select("categoria_codigo, competencia").eq("empresa_id", empresaId).eq("origem", "automatica");
    // A NFS-e volta; a NF-e não (a SEFAZ não entrega de novo: a busca continua do NSU 2)
    expect(depois?.map((d) => `${d.categoria_codigo}:${d.competencia}`)).toEqual(["nfse:2026-09-01"]);
    const { data: nsuNfse } = await admin.from("notas_automaticas_nsu").select("ignorado, documento_id").eq("empresa_id", empresaId).eq("servico", "nfse").single();
    expect(nsuNfse?.ignorado).toBe(false);
    expect(nsuNfse?.documento_id).toBeTruthy();
  }, 120_000);

  it("ciência em lotes: 45 NF-e só em resumo recebem a ciência numa única busca (lotes de 20, 20 e 5)", async () => {
    const { executarNotasAutomaticas } = await import("@/lib/notas-automaticas/sincronizar");
    await admin.from("nfe_resumos").delete().eq("empresa_id", empresaId);
    const chaves = Array.from({ length: 45 }, (_, i) => `1726095556667700018855001${String(70000 + i).padStart(9, "0")}1${String(70000 + i).padStart(8, "0")}0`);
    const { error } = await admin.from("nfe_resumos").insert(
      chaves.map((chave, i) => ({
        empresa_id: empresaId,
        chave,
        emitente_documento: "55566677000188",
        emitente_nome: "FORNECEDOR LOTE (FICTICIO)",
        data_emissao: "2026-09-15T10:00:00-03:00",
        tipo_operacao: "entrada",
        valor: 10 + i,
        recebido_em: new Date(Date.now() - (45 - i) * 1000).toISOString(),
      })),
    );
    if (error) throw error;
    // Só a ciência: a NF-e ainda espera a hora da SEFAZ e a NFS-e não está na vez
    const depois = new Date(Date.now() + 3_600_000).toISOString();
    await admin
      .from("notas_automaticas")
      .update({ ciencia_automatica: true, nfe_ativa: true, pausada: false, nfe_proxima: depois, nfse_proxima: depois, executando_ate: null, erros_seguidos: 0 })
      .eq("empresa_id", empresaId);
    await admin.from("notas_automaticas_execucoes").delete().eq("empresa_id", empresaId);
    const antes = eventosRecebidos.length;
    const job = { id: 4, tipo: "notas_automaticas", payload: { empresa_id: empresaId } } as never;
    const r = (await executarNotasAutomaticas(admin as never, job, {
      urls: { distribuicao: `${base}/dist`, evento: `${base}/evento`, nfse: `${base}/nfse` },
      ca: [ac.pem],
    })) as { erros: string[] };
    expect(r.erros).toEqual([]);
    const lotes = eventosRecebidos.slice(antes).map((corpo) => [...corpo.matchAll(/<chNFe>(\d{44})<\/chNFe>/g)].length);
    expect(lotes).toEqual([20, 20, 5]);
    const { count: semCiencia } = await admin.from("nfe_resumos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).is("ciencia_em", null);
    expect(semCiencia).toBe(0);
    const { data: execucoes } = await admin.from("notas_automaticas_execucoes").select("servico, resumos").eq("empresa_id", empresaId).order("iniciado_em");
    expect(execucoes?.map((e) => `${e.servico}:${e.resumos}`)).toEqual(["ciencia:20", "ciencia:20", "ciencia:5"]);
  }, 120_000);

  it("confirmação da operação pedida: envia o evento 210200 assinado e guarda o retorno da SEFAZ", async () => {
    const { executarNotasAutomaticas } = await import("@/lib/notas-automaticas/sincronizar");
    await admin.from("nfe_resumos").delete().eq("empresa_id", empresaId);
    const chave = "17260955566677000188550010000092011000092010";
    const { error } = await admin.from("nfe_resumos").insert({
      empresa_id: empresaId,
      chave,
      emitente_nome: "FORNECEDOR CONFIRMACAO (FICTICIO)",
      data_emissao: "2026-09-02T10:00:00-03:00",
      valor: 50,
      ciencia_retorno: "596 - Rejeicao: Evento apresentado apos o prazo permitido para o evento: [10 dias]",
      confirmacao_pedida_em: new Date().toISOString(),
    });
    if (error) throw error;
    // Ciência desligada: só a confirmação pedida sai; a NF-e e a NFS-e não estão na vez
    const depois = new Date(Date.now() + 3_600_000).toISOString();
    await admin
      .from("notas_automaticas")
      .update({ ciencia_automatica: false, nfe_ativa: true, pausada: false, nfe_proxima: depois, nfse_proxima: depois, executando_ate: null, erros_seguidos: 0 })
      .eq("empresa_id", empresaId);
    await admin.from("notas_automaticas_execucoes").delete().eq("empresa_id", empresaId);
    const antes = eventosRecebidos.length;
    const job = { id: 5, tipo: "notas_automaticas", payload: { empresa_id: empresaId } } as never;
    const r = (await executarNotasAutomaticas(admin as never, job, {
      urls: { distribuicao: `${base}/dist`, evento: `${base}/evento`, nfse: `${base}/nfse` },
      ca: [ac.pem],
    })) as { erros: string[] };
    expect(r.erros).toEqual([]);
    const novos = eventosRecebidos.slice(antes);
    expect(novos).toHaveLength(1);
    const env = /<envEvento[\s\S]*<\/envEvento>/.exec(novos[0])![0];
    expect(env).toContain(`<chNFe>${chave}</chNFe>`);
    expect(env).toContain("<tpEvento>210200</tpEvento>");
    expect(env).toContain("<descEvento>Confirmacao da Operacao</descEvento>");
    const doc = new DOMParser().parseFromString(env, "text/xml");
    const certEnviado = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(env)![1];
    const v = new SignedXml({ publicCert: `-----BEGIN CERTIFICATE-----\n${certEnviado}\n-----END CERTIFICATE-----` });
    v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]);
    expect(v.checkSignature(env)).toBe(true);
    const { data: nota } = await admin.from("nfe_resumos").select("confirmacao_em, confirmacao_retorno, ciencia_em").eq("empresa_id", empresaId).eq("chave", chave).single();
    expect(nota?.confirmacao_em).not.toBeNull();
    expect(nota?.confirmacao_retorno).toMatch(/^135 - /);
    expect(nota?.ciencia_em).toBeNull();
    const { data: execucoes } = await admin.from("notas_automaticas_execucoes").select("servico, resultado, resumos").eq("empresa_id", empresaId);
    expect(execucoes?.map((e) => `${e.servico}:${e.resultado}:${e.resumos}`)).toEqual(["confirmacao:novos:1"]);
  }, 120_000);
});

