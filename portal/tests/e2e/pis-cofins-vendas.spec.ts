import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * PIS e Cofins nas vendas de empresa do regime normal (comercial de grãos da
 * demonstração, Lucro Real; dados fictícios):
 *  - as operações de venda de milho e soja saem tributadas (CST 01, 1,65% e 7,6%);
 *  - operação nova já vem com o PIS e a Cofins do regime;
 *  - escolher um CST sem PIS/Cofins mostra o aviso de que a nota sai sem as contribuições.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const GRAOS = "COMERCIAL DE GRAOS CERRADO EXEMPLO LTDA (DEMONSTRAÇÃO)";

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
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

test("venda de grãos no Lucro Real: PIS e Cofins tributados e aviso quando a operação tira as contribuições", async ({ page }) => {
  test.setTimeout(180_000);
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", GRAOS).single();
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${emp!.id}/notas-produto/configuracao`);
  await expect(page.getByText("Venda de grãos para outro estado (DEMO)")).toBeVisible();
  await expect(page.getByText(/PIS 01\s*1,65% \/ Cofins 01\s*7,6%/).first()).toBeVisible();
  await expect(page.getByText("Operações de venda sem PIS e Cofins")).toHaveCount(0);

  await page.getByRole("button", { name: "Nova operação" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByLabel("CST do PIS")).toHaveValue("01");
  await expect(dialogo.getByLabel("Alíquota do PIS (%)")).toHaveValue("1,65");
  await expect(dialogo.getByLabel("CST da Cofins")).toHaveValue("01");
  await expect(dialogo.getByLabel("Alíquota da Cofins (%)")).toHaveValue("7,6");
  await expect(dialogo.getByText("sem PIS e Cofins")).toHaveCount(0);
  await dialogo.getByLabel("CST do PIS").selectOption("08");
  await expect(dialogo.getByText("sem PIS e Cofins")).toBeVisible();
});
