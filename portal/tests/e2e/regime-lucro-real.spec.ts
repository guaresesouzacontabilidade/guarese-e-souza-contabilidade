import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/**
 * Regime Lucro Real sem a apuração informada: o aviso na tabela de regimes
 * abre o formulário do período, e a escolha (trimestral ou anual) fica gravada.
 * A tabela cabe no cartão (o lápis de editar não fica escondido).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

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

function clienteServico() {
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

test("aviso do Lucro Real abre o formulário e grava a apuração", async ({ page }) => {
  const admin = clienteServico();
  test.skip(!admin, "Precisa do Supabase local (.env.local) para preparar os dados.");
  const { data: emp } = await admin!.from("empresas").select("id").eq("nome_fantasia", "Oficina Exemplo (DEMO)").single();
  const { data: periodo } = await admin!.from("empresa_regimes").select("id, regime, lucro_real_apuracao").eq("empresa_id", emp!.id).is("fim", null).single();
  const { error } = await admin!.from("empresa_regimes").update({ regime: "lucro_real", lucro_real_apuracao: null }).eq("id", periodo!.id);
  expect(error).toBeNull();
  try {
    await entrar(page, `contador@${DOMINIO}`);
    await page.goto(`/escritorio/obrigacoes/empresas/${emp!.id}`);
    // O lápis de editar está à vista (a tabela não precisa de rolagem lateral)
    await expect(page.getByRole("button", { name: "Editar período" }).first()).toBeInViewport({ timeout: 90_000 });
    await page.getByRole("button", { name: "Informar se é trimestral ou anual" }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText("Editar período de regime")).toBeVisible();
    await dialogo.locator("#lucro_real_apuracao").selectOption("trimestral");
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("button", { name: "Informar se é trimestral ou anual" })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Trimestral", { exact: true })).toBeVisible();
    const { data: depois } = await admin!.from("empresa_regimes").select("lucro_real_apuracao").eq("id", periodo!.id).single();
    expect(depois?.lucro_real_apuracao).toBe("trimestral");
  } finally {
    await admin!.from("empresa_regimes").update({ regime: periodo!.regime, lucro_real_apuracao: periodo!.lucro_real_apuracao }).eq("id", periodo!.id);
  }
});
