import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Documentos: o filtro de categoria separa as NFS-e tomadas (serviços
 * contratados) das prestadas (emitidas pela empresa), pela operação da nota
 * lida. Dados fictícios da Padaria; uma NFS-e vira "tomada" só durante o teste.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

function clienteServico(): SupabaseClient | null {
  if (existsSync(".env.local")) {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const chave = process.env.SUPABASE_SECRET_KEY ?? "";
  return url && chave ? createClient(url, chave, { auth: { persistSession: false } }) : null;
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
let tomada: { fiscalId: string; nome: string } | null = null;
let prestadas = 0;

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").like("razao_social", "PADARIA PAO DOURADO%").maybeSingle();
  if (!emp) return;
  empresaId = emp.id;
  const { data: notas } = await servico!
    .from("documentos_fiscais")
    .select("id, operacao, documento:documentos!inner(nome_original, categoria_codigo, excluido_em, zip_origem_id)")
    .eq("empresa_id", empresaId)
    .like("modelo", "nfse%")
    .eq("documento.categoria_codigo", "nfse")
    .is("documento.excluido_em", null)
    .is("documento.zip_origem_id", null);
  const lista = (notas ?? []) as unknown as { id: string; operacao: string; documento: { nome_original: string } }[];
  if (lista.length < 2) return;
  // Uma das NFS-e da demonstração passa a ser tomada durante o teste
  tomada = { fiscalId: lista[0].id, nome: lista[0].documento.nome_original };
  await servico!.from("documentos_fiscais").update({ operacao: "entrada" }).eq("id", tomada.fiscalId);
  prestadas = lista.length - 1;
});

test.afterAll(async () => {
  if (tomada) await servico!.from("documentos_fiscais").update({ operacao: "saida" }).eq("id", tomada.fiscalId);
});

test("filtro de categoria separa NFS-e tomadas e prestadas", async ({ page }) => {
  test.skip(!tomada, "Rode o seed da demonstração (NFS-e da Padaria).");
  test.setTimeout(120_000);
  await entrar(page, `contador@${DOMINIO}`);

  await page.goto(`/e/${empresaId}/documentos?categoria=${encodeURIComponent("nfse:tomadas")}`);
  await expect(page.getByLabel("Categoria")).toHaveValue("nfse:tomadas");
  await expect(page.getByText(tomada!.nome).first()).toBeVisible();
  await expect(page.getByText("NFS-e tomada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NFS-e prestada", { exact: true })).toHaveCount(0);

  await page.goto(`/e/${empresaId}/documentos?categoria=${encodeURIComponent("nfse:prestadas")}`);
  await expect(page.getByText("NFS-e prestada", { exact: true })).toHaveCount(prestadas);
  await expect(page.getByText(tomada!.nome)).toHaveCount(0);

  // Categoria geral continua trazendo as duas
  await page.goto(`/e/${empresaId}/documentos?categoria=nfse`);
  await expect(page.getByText(tomada!.nome).first()).toBeVisible();
  await expect(page.getByText("NFS-e prestada", { exact: true })).toHaveCount(prestadas);
});
