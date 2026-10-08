import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";

/**
 * Lote de XML grande (dividido em partes) contra o Supabase local: usa as
 * notas fictícias de 09/2026 da Padaria de demonstração, força partes de 2
 * arquivos e confere as partes, os nomes, a relação e o LEIA-ME. Apaga tudo o
 * que criou no fim.
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

describe.skipIf(!local)("XML em lote — partes (Supabase local)", () => {
  const admin = createClient(URL_SUPABASE, CHAVE_SECRETA, { auth: { persistSession: false } });
  let empresaId = "";
  let loteId = "";

  async function limpar() {
    if (!loteId) return;
    const { data } = await admin.from("xml_lotes").select("partes").eq("id", loteId).maybeSingle();
    const caminhos = ((data?.partes ?? []) as { caminho: string }[]).map((p) => p.caminho);
    if (caminhos.length) await admin.storage.from("documentos").remove(caminhos);
    await admin.from("xml_lotes").update({ partes: [] }).eq("id", loteId);
    await admin.from("xml_lotes").delete().eq("id", loteId);
    await admin.from("jobs").delete().like("chave_idempotencia", `lote:${loteId}%`);
  }

  beforeAll(async () => {
    const { data: emp } = await admin.from("empresas").select("id").eq("documento", CNPJ).maybeSingle();
    if (!emp) throw new Error("Rode `npm run seed:demo` (empresa fictícia de demonstração).");
    empresaId = emp.id;
    const { data, error } = await admin
      .from("xml_lotes")
      .insert({ empresa_id: empresaId, competencia: "2026-09-01", tipos: ["nfe_entrada", "nfce"], equipe: true, solicitado_por: null })
      .select("id")
      .single();
    if (error) throw error;
    loteId = data.id;
  }, 30_000);

  afterAll(async () => {
    await limpar();
  }, 30_000);

  it("divide em partes, nomeia 'parte N de M' e põe a relação e o LEIA-ME na última", async () => {
    const { gerarLoteXml } = await import("@/lib/lotes-xml/gerar");
    const job = { id: 1, tipo: "gerar_lote_xml", payload: { lote_id: loteId }, tentativas: 1, max_tentativas: 5 } as never;
    const prazo = { prazo: Date.now() + 120_000 };
    const r1 = (await gerarLoteXml(admin as never, job, prazo, { maxArquivosParte: 2 })) as { parte?: number; arquivos?: number };
    expect(r1).toMatchObject({ parte: 1, arquivos: 2 });
    const { count: proxima } = await admin.from("jobs").select("id", { count: "exact", head: true }).eq("chave_idempotencia", `lote:${loteId}:2`);
    expect(proxima).toBe(1);
    // Notas de 09/2026 da Padaria: 3 NF-e de entrada (bebidas e as duas compras de outros estados da apuração do ICMS) e 2 NFC-e
    const r2 = (await gerarLoteXml(admin as never, job, prazo, { maxArquivosParte: 2 })) as { parte?: number; arquivos?: number };
    expect(r2).toMatchObject({ parte: 2, arquivos: 2 });
    const r3 = (await gerarLoteXml(admin as never, job, prazo, { maxArquivosParte: 2 })) as { concluido?: boolean; partes?: number };
    expect(r3).toMatchObject({ concluido: true, partes: 3 });

    const { data: lote } = await admin.from("xml_lotes").select("situacao, partes, total_arquivos, expira_em").eq("id", loteId).single();
    expect(lote).toMatchObject({ situacao: "pronto", total_arquivos: 5 });
    const partes = lote!.partes as { numero: number; caminho: string; nome: string; arquivos: number }[];
    expect(partes.map((p) => p.nome)).toEqual([
      "xml-2026-09-padaria-pao-dourado-demo-parte-1-de-3.zip",
      "xml-2026-09-padaria-pao-dourado-demo-parte-2-de-3.zip",
      "xml-2026-09-padaria-pao-dourado-demo-parte-3-de-3.zip",
    ]);
    expect(partes.map((p) => p.arquivos)).toEqual([2, 2, 1]);

    const abrir = async (caminho: string) => {
      const { data } = await admin.storage.from("documentos").download(caminho);
      return unzipSync(new Uint8Array(await data!.arrayBuffer()));
    };
    const p1 = await abrir(partes[0].caminho);
    const ultima = await abrir(partes[2].caminho);
    expect(Object.keys(p1).filter((n) => n.endsWith(".xml"))).toHaveLength(2);
    expect(Object.keys(p1)).not.toContain("Relacao das notas.xlsx");
    expect(strFromU8(p1["LEIA-ME.txt"])).toContain("Esta é a parte 1 do lote");
    expect(Object.keys(ultima)).toContain("Relacao das notas.xlsx");
    const leiaMe = strFromU8(ultima["LEIA-ME.txt"]);
    expect(leiaMe).toContain("Tipos: NF-e de entrada, NFC-e");
    expect(leiaMe).toContain("Total: 5 arquivos em 3 partes (esta é a parte 3 de 3)");
    expect(leiaMe).toContain("NFC-e: 2 arquivos");
  }, 60_000);
});
