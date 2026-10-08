import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Apuração do ICMS (dados fictícios da demonstração): na Padaria (Simples, TO),
 * as compras de Goiás e de São Paulo geram complementação de alíquota; a equipe
 * marca o detergente como uso e consumo (passa ao diferencial de alíquotas),
 * lança outra guia, confere e reabre o mês. O empresário não abre a apuração.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const PADARIA = "11222333000181";

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
let competencia = "";
let notas: string[] = [];

async function limpar() {
  if (!empresaId) return;
  if (notas.length) await servico!.from("icms_destinacoes").delete().in("documento_fiscal_id", notas);
  await servico!.from("icms_lancamentos").delete().eq("empresa_id", empresaId).like("descricao", "%(E2E)%");
  await servico!.from("icms_apuracoes").delete().eq("empresa_id", empresaId).eq("competencia", competencia);
}

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").eq("documento", PADARIA).single();
  empresaId = emp!.id;
  const { data } = await servico!
    .from("documentos_fiscais")
    .select("id, competencia")
    .eq("empresa_id", empresaId)
    .in("emitente_uf", ["GO", "SP"])
    .eq("operacao", "entrada");
  notas = (data ?? []).map((n) => n.id);
  competencia = data?.[0]?.competencia ?? "";
  await limpar();
});

test.afterAll(limpar);

test("equipe apura o ICMS do Simples: complementação, uso e consumo, outra guia, conferência e reabertura", async ({ page, browser }) => {
  test.skip(notas.length < 2, "Rode o seed da demonstração (compras de outros estados).");
  const url = `/e/${empresaId}/calculos/icms?competencia=${competencia.slice(0, 7)}`;
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Apuração do ICMS", level: 1 })).toBeVisible();
  const complementacao = page.locator("tr", { hasText: "complementação de alíquota" });
  // Goiás: (2.000 + 100 de frete + 300) × 25% × 8% = 48,00; São Paulo (Simples): 1.000 × 25% × 13% = 32,50
  await expect(complementacao).toContainText("R$ 80,50");

  // Detergente (item 2 da nota de Goiás) é uso e consumo: sai da complementação e paga o diferencial
  const notaGoias = page.locator('li[data-nota="4401"]');
  await notaGoias.getByText("Itens e cálculo (2)").click();
  await notaGoias.getByRole("combobox", { name: "Destinação do item 2 da NF-e 4401/1" }).selectOption("uso_consumo");
  await expect(page.getByText("Destinação: uso e consumo.")).toBeVisible({ timeout: 30_000 });
  // Simples: 300 × (20% − 12%) = 24,00; complementação 80,50 − 6,00 = 74,50
  await expect(page.locator("tr", { hasText: "diferencial de alíquotas" })).toContainText("R$ 24,00");
  await expect(complementacao).toContainText("R$ 74,50");

  // Outra guia lançada pelo escritório
  await page.fill("#icms-lanc-desc", "ICMS-ST na entrada (E2E)");
  await page.fill("#icms-lanc-valor", "10,00");
  await page.getByRole("button", { name: "Lançar" }).click();
  await expect(page.getByText("Valor lançado na apuração.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tr", { hasText: "Total em guias de ICMS" })).toContainText("R$ 108,50");

  // Conferência: o mês fica travado
  await page.getByRole("button", { name: "Conferir o mês" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Conferir" }).click();
  await expect(page.getByText(/Apuração do ICMS conferida\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/conferida em/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Lançar" })).toHaveCount(0);
  const { data: ap } = await servico!.from("icms_apuracoes").select("total_guias").eq("empresa_id", empresaId).eq("competencia", competencia).single();
  expect(Number(ap!.total_guias)).toBe(108.5);

  // A previsão de impostos passa a mostrar a guia conferida
  await page.goto(`/e/${empresaId}/calculos?competencia=${competencia.slice(0, 7)}`);
  await expect(page.locator("tr", { hasText: "complementação de alíquota" })).toContainText("R$ 74,50");

  // Carteira do escritório
  await page.goto(`/escritorio/icms?competencia=${competencia.slice(0, 7)}`);
  const linha = page.locator("tr", { hasText: "Padaria Pão Dourado" });
  await expect(linha).toContainText("conferida");
  await expect(linha).toContainText("R$ 108,50");

  // Reabertura com motivo
  await page.goto(url);
  await page.getByRole("button", { name: "Reabrir" }).click();
  await page.fill("#icms-reabrir-motivo", "Teste automático de reabertura");
  await page.getByRole("dialog").getByRole("button", { name: "Reabrir" }).click();
  await expect(page.getByText("Apuração reaberta.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Conferir o mês" })).toBeVisible();

  // O empresário não abre a apuração (é da equipe)
  const ctx = await browser.newContext({ locale: "pt-BR" });
  const cliente = await ctx.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto(url);
  await expect(cliente.getByText("A apuração do ICMS é feita pela equipe do escritório.")).toBeVisible();
  await expect(cliente.getByRole("link", { name: "Apuração do ICMS" })).toHaveCount(0);
  await ctx.close();
});
