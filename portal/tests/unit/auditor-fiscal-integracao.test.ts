import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Auditor fiscal de ponta a ponta contra o Supabase local: os XML de teste
 * entram pelo mesmo registro dos XML enviados, o auditor relê e analisa, e
 * os achados ficam gravados. Usa a empresa de demonstração "Padaria" (CNPJ
 * fictício dos XML de teste) e apaga tudo o que criou no fim.
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
const PREFIXO = "teste-auditor-";
// Os XML de teste são de 09/2026; aqui vão para 03/2025, mês sem notas da demonstração.
const MES = "2025-03";
const fixture = (nome: string) => readFileSync(`tests/fixtures/${nome}`, "utf8");

describe.skipIf(!local)("auditor fiscal — análise de ponta a ponta (Supabase local)", () => {
  const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, { auth: { persistSession: false } });
  let empresaId = "";
  const fiscais: Record<string, string> = {};

  async function inserirXml(arquivo: string) {
    const { lerXmlFiscal } = await import("@/lib/fiscal/xml");
    const { registrarXml } = await import("@/lib/documentos/processar");
    const xml = fixture(arquivo).replaceAll("2026-09-", `${MES}-`);
    const lido = lerXmlFiscal(xml, { documento: CNPJ });
    if (!lido.sucesso || lido.dados.tipo !== "nota") throw new Error(`Fixture inválida: ${arquivo}`);
    const id = randomUUID();
    const bytes = Buffer.from(xml, "utf8");
    const caminho = `${empresaId}/${MES}/${id}/v1-${PREFIXO}${arquivo}`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const agora = new Date().toISOString();
    const { error: e1 } = await admin.storage.from("documentos").upload(caminho, bytes, { contentType: "application/xml" });
    if (e1) throw e1;
    const { error: e2 } = await admin.from("documentos").insert({
      id, empresa_id: empresaId, direcao: "cliente", competencia: `${MES}-01`, categoria_codigo: "nfe_entrada_xml",
      nome_original: `${PREFIXO}${arquivo}`, extensao: "xml", mime: "application/xml", tamanho: bytes.length, sha256: hash, versao_atual: 1,
      storage_path: caminho, upload_status: "concluido", status: "recebido", origem: "sistema", verificacao_status: "ok", enviado_em: agora,
      processamento_status: "concluido",
    });
    if (e2) throw e2;
    await admin.from("documento_versoes").insert({
      documento_id: id, empresa_id: empresaId, versao: 1, storage_path: caminho, nome_original: `${PREFIXO}${arquivo}`, mime: "application/xml",
      tamanho: bytes.length, sha256: hash, upload_concluido_em: agora, verificacao_status: "ok",
    });
    const registro = await registrarXml(admin as never, id, lido.dados);
    fiscais[arquivo] = registro.documento_fiscal_id!;
  }

  async function limpar() {
    await admin.from("auditor_achados").delete().eq("empresa_id", empresaId).like("chave", `%:${MES}`);
    await admin.from("jobs").delete().eq("empresa_id", empresaId).eq("tipo", "auditor_fiscal");
    const { data: docs } = await admin.from("documentos").select("id, storage_path").eq("empresa_id", empresaId).like("nome_original", `${PREFIXO}%`);
    if (!docs?.length) return;
    const ids = docs.map((d) => d.id);
    const { data: fs } = await admin.from("documentos_fiscais").select("id").in("documento_id", ids);
    const idsFiscais = (fs ?? []).map((f) => f.id);
    for (const passo of [
      () => admin.from("lancamentos").delete().in("documento_fiscal_id", idsFiscais.length ? idsFiscais : ["00000000-0000-0000-0000-000000000000"]),
      () => admin.from("documentos_fiscais").delete().in("documento_id", ids),
      () => admin.from("documento_versoes").delete().in("documento_id", ids),
      () => admin.from("documentos").delete().in("id", ids),
    ]) {
      const { error } = await passo();
      if (error) throw new Error(`Limpeza do teste falhou: ${error.message}`);
    }
    await admin.storage.from("documentos").remove(docs.map((d) => d.storage_path).filter(Boolean) as string[]);
  }

  beforeAll(async () => {
    const { data: emp } = await admin.from("empresas").select("id").eq("documento", CNPJ).maybeSingle();
    if (!emp) throw new Error("Rode `npm run seed:demo` (empresa fictícia com o CNPJ dos XML de teste).");
    empresaId = emp.id;
    await limpar();
    await inserirXml("nfe-compra-farmacia.xml");
    await inserirXml("nfce-venda-farmacia.xml");
  }, 60_000);

  afterAll(async () => {
    if (empresaId) await limpar();
  }, 60_000);

  it("grava a leitura completa e agenda a análise automática", async () => {
    const { data: venda } = await admin
      .from("documentos_fiscais")
      .select("leitura_versao, crt_emitente, consumidor_final, itens:documento_fiscal_itens(numero_item, gtin, tributos)")
      .eq("id", fiscais["nfce-venda-farmacia.xml"])
      .single();
    expect(venda).toMatchObject({ leitura_versao: 4, crt_emitente: "1", consumidor_final: true });
    const itens = (venda!.itens as { numero_item: number; gtin: string | null; tributos: Record<string, string> }[]).sort((a, b) => a.numero_item - b.numero_item);
    expect(itens[0]).toMatchObject({ gtin: "7891234567895", tributos: { csosn: "102", cst_pis: "49" } });
    const { count } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("tipo", "auditor_fiscal");
    expect(count).toBeGreaterThan(0);
  });

  it("analisa as notas e grava os achados com memória de cálculo", async () => {
    const { executarAuditorFiscal } = await import("@/lib/auditor-fiscal/executar");
    const r = (await executarAuditorFiscal(admin as never, { id: 1, tipo: "auditor_fiscal", payload: { empresa_id: empresaId, origem: "manual" } } as never)) as {
      notas: number;
      oportunidades: number;
    };
    expect(r.notas).toBeGreaterThanOrEqual(2);
    const { data: achados } = await admin.from("auditor_achados").select("*").eq("empresa_id", empresaId).order("regra");
    const porRegra = new Map((achados ?? []).map((a) => [a.chave, a]));
    const mono = porRegra.get(`monofasico_simples:${MES}`)!;
    const st = porRegra.get(`st_simples:${MES}`)!;
    expect(mono).toMatchObject({ tipo: "oportunidade", situacao: "novo", valor_base: 500 });
    expect(Number(mono.valor_estimado)).toBeGreaterThan(0);
    expect((mono.referencias as unknown[]).length).toBe(2);
    expect(st).toMatchObject({ tipo: "oportunidade", valor_base: 360 });
    const { data: exec } = await admin.from("auditor_execucoes").select("situacao, notas_analisadas, achados_novos").eq("empresa_id", empresaId).order("criada_em", { ascending: false }).limit(1).single();
    expect(exec).toMatchObject({ situacao: "concluida" });
    expect(exec!.achados_novos).toBeGreaterThanOrEqual(2);
  });

  it("analisa as notas de serviço: ISS retido no DAS, alíquota da retenção e retenções federais", async () => {
    await inserirXml("nfse-nacional-retencoes.xml");
    const { executarAuditorFiscal } = await import("@/lib/auditor-fiscal/executar");
    const r = (await executarAuditorFiscal(admin as never, { id: 3, tipo: "auditor_fiscal", payload: { empresa_id: empresaId, origem: "manual" } } as never)) as {
      notas_servico: number;
    };
    expect(r.notas_servico).toBeGreaterThanOrEqual(1);
    const { data: achados } = await admin.from("auditor_achados").select("chave, tipo, valor_base, valor_estimado, referencias").eq("empresa_id", empresaId).like("chave", `%:${MES}`);
    const porChave = new Map((achados ?? []).map((a) => [a.chave, a]));
    expect(porChave.get(`iss_retido_simples:${MES}`)).toMatchObject({ tipo: "oportunidade", valor_base: 10000 });
    expect(Number(porChave.get(`iss_retido_simples:${MES}`)!.valor_estimado)).toBeGreaterThan(0);
    expect(porChave.get(`retencao_federal_simples:${MES}`)).toMatchObject({ tipo: "oportunidade", valor_estimado: 615 });
    expect(porChave.get(`iss_aliquota_acima:${MES}`)).toMatchObject({ tipo: "oportunidade" });
  });

  it("relê do arquivo uma nota gravada na leitura antiga e mantém a revisão feita", async () => {
    await admin.from("auditor_achados").update({ situacao: "confirmado" }).eq("empresa_id", empresaId).eq("chave", `monofasico_simples:${MES}`);
    const id = fiscais["nfce-venda-farmacia.xml"];
    await admin.from("documentos_fiscais").update({ leitura_versao: 1 }).eq("id", id);
    await admin.from("documento_fiscal_itens").update({ gtin: null, tributos: {} }).eq("documento_fiscal_id", id);
    const { executarAuditorFiscal } = await import("@/lib/auditor-fiscal/executar");
    await executarAuditorFiscal(admin as never, { id: 2, tipo: "auditor_fiscal", payload: { empresa_id: empresaId, origem: "manual" } } as never);
    const { data: nota } = await admin.from("documentos_fiscais").select("leitura_versao, itens:documento_fiscal_itens(gtin)").eq("id", id).single();
    expect(nota?.leitura_versao).toBe(4);
    expect((nota!.itens as { gtin: string | null }[]).some((i) => i.gtin === "7891234567895")).toBe(true);
    const { data: mono } = await admin.from("auditor_achados").select("situacao, valores_alterados_em").eq("empresa_id", empresaId).eq("chave", `monofasico_simples:${MES}`).single();
    expect(mono).toMatchObject({ situacao: "confirmado", valores_alterados_em: null });
  });
});
