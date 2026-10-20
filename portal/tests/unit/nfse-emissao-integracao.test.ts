import { describe, expect, it, beforeAll, afterAll } from "vitest";
import forge from "node-forge";
import https from "node:https";
import { readFileSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import { nfseFicticia } from "./apoio/nfse-ficticia";
import { semearNfse } from "../../scripts/demo-nfse";

/**
 * Emissão de NFS-e de ponta a ponta contra o Supabase local e um servidor
 * local que faz o papel do Emissor Nacional (TLS com certificado do cliente,
 * respostas no formato da API). Usa a empresa de demonstração "Oficina"
 * (lucro presumido) e apaga tudo o que criou no fim. Notas FICTÍCIAS.
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

const CNPJ = "44555666000181";
const TITULAR = `OFICINA (DEMO):${CNPJ}`;

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

describe.skipIf(!local)("NFS-e — emissão de ponta a ponta (Supabase local)", () => {
  const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, { auth: { persistSession: false } });
  let empresaId = "";
  let servicoId = "";
  let servidor: https.Server;
  let base = "";
  let ac: ReturnType<typeof cert>;
  let chavesEmpresa: { chavePem: string; certificadoPem: string };
  let chaveAnterior: string | undefined;
  /** Comportamento do servidor para o próximo pedido */
  let modo: "autoriza" | "rejeita" | "erro500" = "autoriza";
  const recebidas: { metodo: string; url: string; corpo: string }[] = [];
  const emitidas = new Map<string, { chave: string; xml: string }>();
  let numero = 100;

  const responder = (res: import("node:http").ServerResponse, status: number, corpo: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
  };

  beforeAll(async () => {
    const { data: emp } = await admin.from("empresas").select("id").eq("documento", CNPJ).maybeSingle();
    if (!emp) throw new Error("Rode `npm run seed:demo` (empresa fictícia Oficina).");
    empresaId = emp.id;
    await limpar();

    chaveAnterior = process.env.CERTIFICADOS_CHAVE;
    process.env.CERTIFICADOS_CHAVE = randomBytes(32).toString("base64");
    const { cifrar } = await import("@/lib/notas-automaticas/cripto");
    const pAc = par();
    ac = cert(pAc, "AC TESTE LOCAL");
    const pEmp = par();
    const cEmp = cert(pEmp, TITULAR, { p: pAc, c: ac.c });
    chavesEmpresa = { chavePem: pEmp.pem, certificadoPem: cEmp.pem };
    const pSrv = par();
    const cSrv = cert(pSrv, "localhost", { p: pAc, c: ac.c }, "localhost");

    const { data: c, error } = await admin
      .from("certificados_digitais")
      .insert({
        empresa_id: empresaId,
        titular: TITULAR,
        documento: CNPJ,
        impressao_digital: "B".repeat(64),
        valido_de: new Date(Date.now() - 86_400_000).toISOString(),
        valido_ate: new Date(Date.now() + 200 * 86_400_000).toISOString(),
        autorizacao: "autorizacao_escrita",
        autorizacao_texto: "Teste automático de integração (emissão).",
      })
      .select("id")
      .single();
    if (error) throw error;
    await admin.from("certificados_segredos").insert({ certificado_id: c.id, conteudo_cifrado: cifrar(JSON.stringify({ chave: pEmp.pem, certificados: [cEmp.pem] })) });
    const { data: s, error: e2 } = await admin
      .from("nfse_servicos")
      .insert({ empresa_id: empresaId, nome: "Manutenção de veículos (teste)", codigo_tributacao_nacional: "140101" })
      .select("id")
      .single();
    if (e2) throw e2;
    servicoId = s.id;
    const { error: e3 } = await admin.from("nfse_emissao_config").insert({
      empresa_id: empresaId,
      ativa: true,
      ambiente: "homologacao",
      codigo_municipio: "1718204",
      percentual_tributos_federais: 13.45,
      percentual_tributos_municipais: 5,
      enviar_email_tomador: false,
      autorizacao_texto: "Teste automático de integração (emissão).",
      autorizado_em: new Date().toISOString(),
    });
    if (e3) throw e3;

    servidor = https.createServer({ key: pSrv.pem, cert: cSrv.pem, ca: [ac.pem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let corpo = "";
      req.on("data", (b) => (corpo += b));
      req.on("end", () => {
        recebidas.push({ metodo: req.method ?? "", url: req.url ?? "", corpo });
        const cn = (req.socket as import("node:tls").TLSSocket).getPeerCertificate().subject?.CN;
        if (cn !== TITULAR) return responder(res, 403, { mensagem: "certificado" });
        if (req.method === "POST" && req.url === "/SefinNacional/nfse") {
          const dps = gunzipSync(Buffer.from(JSON.parse(corpo).dpsXmlGZipB64, "base64")).toString("utf8");
          if (modo === "erro500") return responder(res, 500, { mensagem: "instabilidade" });
          if (modo === "rejeita") {
            return responder(res, 400, { tipoAmbiente: 2, erros: [{ Codigo: "E0310", Descricao: "Código de tributação nacional não administrado pelo município.", Complemento: null }] });
          }
          const idDps = /Id="(DPS\d{42})"/.exec(dps)![1];
          const n = nfseFicticia(dps, { cnpj: CNPJ, numero: ++numero, ambiente: 2, chaves: chavesEmpresa });
          emitidas.set(idDps, n);
          return responder(res, 201, { tipoAmbiente: 2, versaoAplicativo: "teste", idDps, chaveAcesso: n.chave, nfseXmlGZipB64: gzipSync(n.xml).toString("base64") });
        }
        const dpsMatch = /^\/SefinNacional\/dps\/(DPS\d{42})$/.exec(req.url ?? "");
        if (req.method === "GET" && dpsMatch) {
          const n = emitidas.get(dpsMatch[1]);
          return n ? responder(res, 200, { chaveAcesso: n.chave }) : responder(res, 404, { erros: [{ Codigo: "E2404", Descricao: "DPS não encontrada" }] });
        }
        const nfseMatch = /^\/SefinNacional\/nfse\/(\d{50})(\/eventos)?$/.exec(req.url ?? "");
        if (nfseMatch && req.method === "GET") {
          const n = [...emitidas.values()].find((x) => x.chave === nfseMatch[1]);
          return n ? responder(res, 200, { chaveAcesso: n.chave, nfseXmlGZipB64: gzipSync(n.xml).toString("base64") }) : responder(res, 404, {});
        }
        if (nfseMatch && nfseMatch[2] && req.method === "POST") {
          const pedido = gunzipSync(Buffer.from(JSON.parse(corpo).pedidoRegistroEventoXmlGZipB64, "base64")).toString("utf8");
          const evento = `<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infEvento Id="EVT${nfseMatch[1]}101101001">${pedido.replace(' xmlns="http://www.sped.fazenda.gov.br/nfse"', "")}</infEvento></evento>`;
          return responder(res, 201, { tipoAmbiente: 2, eventoXmlGZipB64: gzipSync(evento).toString("base64") });
        }
        responder(res, 404, {});
      });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    base = `https://localhost:${(servidor.address() as AddressInfo).port}/SefinNacional`;
  }, 60_000);

  async function limpar() {
    await admin.from("nfse_emissoes").delete().eq("empresa_id", empresaId);
    await admin.from("nfse_emissao_config").delete().eq("empresa_id", empresaId);
    await admin.from("nfse_servicos").delete().eq("empresa_id", empresaId);
    await admin.from("certificados_digitais").delete().eq("empresa_id", empresaId);
    await admin.from("jobs").delete().eq("empresa_id", empresaId).in("tipo", ["emitir_nfse", "cancelar_nfse"]);
    await admin.from("notificacoes").delete().eq("empresa_id", empresaId).eq("tipo", "nfse");
  }

  afterAll(async () => {
    servidor?.close();
    if (empresaId) {
      await limpar();
      // Devolve a configuração e os serviços da demonstração (usados pelos testes de tela)
      await semearNfse(admin, empresaId);
    }
    process.env.CERTIFICADOS_CHAVE = chaveAnterior;
  }, 60_000);

  let seq = 0;
  async function pedido(extra: Record<string, unknown> = {}) {
    seq++;
    const n = 9000 + seq;
    const { data, error } = await admin
      .from("nfse_emissoes")
      .insert({
        empresa_id: empresaId,
        servico_id: servicoId,
        ambiente: "homologacao",
        serie: 1,
        numero_dps: n,
        id_dps: `DPS17182042${CNPJ}00001${String(n).padStart(15, "0")}`,
        competencia: new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10),
        codigo_municipio_emissor: "1718204",
        local_prestacao: "1718204",
        codigo_tributacao_nacional: "140101",
        descricao: "Revisão completa do veículo (teste automático)",
        valor: 850.5,
        tomador_tipo: "cnpj",
        tomador_documento: "12345678000195",
        tomador_nome: "Transportadora Fictícia Ltda",
        tomador_endereco: { logradouro: "Rua Teste", numero: "1", bairro: "Centro", codigo_municipio: "1718204", municipio: "Porto Nacional", uf: "TO", cep: "77500000" },
        ...extra,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const job = (id: string, tentativas = 1) => ({ id: 1, tipo: "emitir_nfse", payload: { emissao_id: id }, tentativas, max_tentativas: 5 }) as never;

  it("emite: DPS assinada no leiaute, enviada com o certificado; nota de teste guardada e sem entrar nos documentos", async () => {
    const { emitirNfse } = await import("@/lib/nfse-emissao/emitir");
    const p = await pedido();
    modo = "autoriza";
    const r = (await emitirNfse(admin as never, job(p.id), { base, ca: [ac.pem] })) as { situacao: string };
    expect(r.situacao).toBe("autorizada");

    const envio = recebidas.find((x) => x.metodo === "POST" && x.url === "/SefinNacional/nfse")!;
    const dps = gunzipSync(Buffer.from(JSON.parse(envio.corpo).dpsXmlGZipB64, "base64")).toString("utf8");
    expect(dps.startsWith('<?xml version="1.0" encoding="UTF-8"?><DPS ')).toBe(true);
    expect(dps).toContain(`<infDPS Id="${p.id_dps}">`);
    expect(dps).toContain("<tpAmb>2</tpAmb>");
    expect(dps).toContain("<opSimpNac>1</opSimpNac>");
    expect(dps).toContain("<pTotTribFed>13.45</pTotTribFed>");
    expect(dps).toContain("<vServ>850.50</vServ>");
    const doc = new DOMParser().parseFromString(dps, "text/xml");
    const v = new SignedXml({ publicCert: chavesEmpresa.certificadoPem });
    v.loadSignature(doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0] as unknown as Node);
    expect(v.checkSignature(dps)).toBe(true);

    const { data: e } = await admin.from("nfse_emissoes").select("*").eq("id", p.id).single();
    expect(e).toMatchObject({ situacao: "autorizada", numero_nfse: String(numero), tentativas: 1, documento_id: null });
    expect(e!.chave_acesso).toMatch(/^[0-9]{50}$/);
    expect(e!.xml_nfse).toContain("<NFSe");
  });

  it("rejeição do Emissor Nacional fica registrada com o motivo e avisa", async () => {
    const { emitirNfse } = await import("@/lib/nfse-emissao/emitir");
    const p = await pedido({ descricao: "Pedido que será rejeitado (teste)" });
    modo = "rejeita";
    await emitirNfse(admin as never, job(p.id), { base, ca: [ac.pem] });
    const { data: e } = await admin.from("nfse_emissoes").select("situacao, mensagens").eq("id", p.id).single();
    expect(e!.situacao).toBe("rejeitada");
    expect(e!.mensagens).toEqual([expect.objectContaining({ codigo: "E0310" })]);
    const { count } = await admin.from("notificacoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("tipo", "nfse");
    expect(count).toBeGreaterThan(0);
  });

  it("sem resposta: volta para a fila; na nova tentativa pergunta pela DPS antes e não emite de novo", async () => {
    const { emitirNfse } = await import("@/lib/nfse-emissao/emitir");
    const p = await pedido({ descricao: "Pedido com instabilidade (teste)" });
    modo = "erro500";
    await expect(emitirNfse(admin as never, job(p.id, 1), { base, ca: [ac.pem] })).rejects.toThrow(/não processou/);
    const { data: falha } = await admin.from("nfse_emissoes").select("situacao, tentativas").eq("id", p.id).single();
    expect(falha).toMatchObject({ situacao: "falha", tentativas: 1 });

    // A DPS "virou nota" no servidor mas a resposta se perdeu: a segunda tentativa só consulta
    modo = "autoriza";
    const { dpsAssinada } = await import("@/lib/nfse-emissao/dps");
    const { dadosDaDps } = await import("@/lib/nfse-emissao/emitir");
    const { data: cfg } = await admin.from("nfse_emissao_config").select("*").eq("empresa_id", empresaId).single();
    const { data: linha } = await admin.from("nfse_emissoes").select("*").eq("id", p.id).single();
    const xmlDps = dpsAssinada(dadosDaDps(linha!, cfg!, { documento: CNPJ, regime_tributario: "lucro_presumido" }, new Date()), chavesEmpresa).xml;
    emitidas.set(p.id_dps, nfseFicticia(xmlDps, { cnpj: CNPJ, numero: ++numero, ambiente: 2, chaves: chavesEmpresa }));
    const antes = recebidas.filter((x) => x.metodo === "POST" && x.url === "/SefinNacional/nfse").length;
    const r = (await emitirNfse(admin as never, job(p.id, 2), { base, ca: [ac.pem] })) as { situacao: string };
    expect(r.situacao).toBe("autorizada");
    expect(recebidas.filter((x) => x.metodo === "POST" && x.url === "/SefinNacional/nfse").length).toBe(antes);
    expect(recebidas.some((x) => x.url === `/SefinNacional/dps/${p.id_dps}`)).toBe(true);
  });

  it("cancelamento: pedido assinado (evento 101101) e nota cancelada", async () => {
    const { cancelarNfse } = await import("@/lib/nfse-emissao/emitir");
    const { data: autorizada } = await admin.from("nfse_emissoes").select("id, chave_acesso").eq("empresa_id", empresaId).eq("situacao", "autorizada").limit(1).single();
    await admin
      .from("nfse_emissoes")
      .update({ situacao: "cancelando", cancelamento_motivo: 1, cancelamento_justificativa: "Valor digitado errado na nota (teste)", cancelamento_pedido_em: new Date().toISOString() })
      .eq("id", autorizada!.id);
    const r = (await cancelarNfse(admin as never, { id: 2, tipo: "cancelar_nfse", payload: { emissao_id: autorizada!.id }, tentativas: 1, max_tentativas: 5 } as never, {
      base,
      ca: [ac.pem],
    })) as { situacao: string };
    expect(r.situacao).toBe("cancelada");
    const envio = recebidas.find((x) => x.metodo === "POST" && x.url === `/SefinNacional/nfse/${autorizada!.chave_acesso}/eventos`)!;
    const xml = gunzipSync(Buffer.from(JSON.parse(envio.corpo).pedidoRegistroEventoXmlGZipB64, "base64")).toString("utf8");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><pedRegEvento ')).toBe(true);
    expect(xml).toContain(`<infPedReg Id="PRE${autorizada!.chave_acesso}101101">`);
    expect(xml).toContain("<cMotivo>1</cMotivo>");
    const { data: e } = await admin.from("nfse_emissoes").select("situacao, cancelada_em, cancelamento_xml").eq("id", autorizada!.id).single();
    expect(e!.situacao).toBe("cancelada");
    expect(e!.cancelamento_xml).toContain("<evento");
  });

  it("em produção a nota autorizada entra nos documentos fiscais da empresa", async () => {
    const { emitirNfse } = await import("@/lib/nfse-emissao/emitir");
    const p = await pedido({ ambiente: "producao", descricao: "Nota em produção (teste local)" });
    modo = "autoriza";
    await emitirNfse(admin as never, job(p.id), { base, ca: [ac.pem] });
    const { data: e } = await admin.from("nfse_emissoes").select("situacao, documento_id").eq("id", p.id).single();
    expect(e!.situacao).toBe("autorizada");
    expect(e!.documento_id).not.toBeNull();
    const { data: doc } = await admin.from("documentos").select("id, storage_path, categoria_codigo, origem").eq("id", e!.documento_id!).single();
    expect(doc).toMatchObject({ categoria_codigo: "nfse", origem: "automatica" });
    // Limpa o documento (e o registro fiscal) criado pelo teste
    await admin.from("nfse_emissoes").update({ documento_id: null }).eq("id", p.id);
    await admin.from("documentos_fiscais").delete().eq("documento_id", doc!.id);
    await admin.from("documentos").delete().eq("id", doc!.id);
    if (doc!.storage_path) await admin.storage.from("documentos").remove([doc!.storage_path]);
  });
});
