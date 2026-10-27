import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Rentabilidade da frota (transportadora fictícia da demonstração):
 *  - o dono vê a síntese do período, o ranking dos veículos e abre um veículo;
 *  - o abastecimento com o km digitado com um número a mais é barrado na hora,
 *    com a explicação (nada é gravado);
 *  - o PDF sai; cliente de outra empresa não vê a frota.
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
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

let empresaId = "";

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").ilike("razao_social", "TRANSPORTES RIO DAS ARARAS%").eq("demonstracao", true).single();
  empresaId = data!.id;
});

test("o dono vê o resultado líquido, abre um veículo e o km digitado errado é barrado", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `transportadora@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/frota`);
  await expect(page.getByRole("heading", { name: "Rentabilidade da frota" })).toBeVisible();
  await expect(page.getByText(/a frota realizou \d+ viagens, percorreu [\d.]+ km, faturou R\$ [\d.,]+ e apresentou resultado líquido/)).toBeVisible();
  await expect(page.getByText("Ranking de resultado por veículo")).toBeVisible();
  await expect(page.getByText(/Análise gerencial ·/)).toBeVisible();

  // Abre o caminhão do Volvo
  await page.getByRole("link", { name: /RTA-4B21/ }).first().click();
  await expect(page.getByText(/o veículo RTA-4B21 realizou \d+ viage/)).toBeVisible();
  await expect(page.getByText("Demonstrativo de resultado do veículo")).toBeVisible();

  // Km com um número a mais (3.440.057 no lugar de 344.057): o portal barra
  const { count: antes } = await servico!.from("frota_despesas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  await page.getByRole("button", { name: "Lançar despesa" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Valor total").fill("1.890,00");
  await dialogo.getByLabel("Litros").fill("300");
  await dialogo.getByLabel("Km do hodômetro").fill("3.440.057");
  await dialogo.getByRole("button", { name: "Lançar despesa" }).click();
  await expect(dialogo.getByText(/mais do que um caminhão roda/).first()).toBeVisible({ timeout: 30_000 });
  const { count: depois } = await servico!.from("frota_despesas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  expect(depois).toBe(antes);
});

test("PDF da frota e isolamento", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `transportadora@${DOMINIO}`);
  const r = await page.request.get(`/api/frota/${empresaId}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("application/pdf");
  await page.context().clearCookies();
  await entrar(page, `cliente@${DOMINIO}`);
  const resposta = await page.goto(`/e/${empresaId}/frota`);
  expect(resposta?.status()).toBe(404);
  expect((await page.request.get(`/api/frota/${empresaId}`)).status()).toBe(403);
});
