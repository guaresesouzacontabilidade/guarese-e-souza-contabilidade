import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * DAR do ICMS de Mato Grosso (dados fictícios): na Grãos Cerrado (DEMO), a
 * equipe abre a EFD do mês, calcula a multa e os juros do DAR e vê que, fora
 * do portal oficial, o robô não acessa a SEFAZ-MT. O empresário não abre a tela.
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
let original: { contribuinte_icms: boolean; inscricao_estadual: string | null } | null = null;

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, contribuinte_icms, inscricao_estadual").like("razao_social", "COMERCIAL DE GRAOS CERRADO%").maybeSingle();
  if (!data) return;
  empresaId = data.id;
  original = { contribuinte_icms: data.contribuinte_icms, inscricao_estadual: data.inscricao_estadual };
  // Contribuinte do ICMS com inscrição fictícia de 9 dígitos, só durante o teste
  await servico!.from("empresas").update({ contribuinte_icms: true, inscricao_estadual: "000000019" }).eq("id", empresaId);
});

test.afterAll(async () => {
  if (empresaId && original) await servico!.from("empresas").update(original).eq("id", empresaId);
});

test.describe.configure({ mode: "serial" });

test("equipe calcula multa e juros do DAR; fora do portal oficial o robô não acessa a SEFAZ-MT", async ({ page }) => {
  test.skip(!empresaId, "Rode o seed da demonstração (Grãos Cerrado).");
  test.setTimeout(120_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/calculos/efd?competencia=2026-08`);
  await expect(page.getByText("DAR do ICMS de agosto de 2026 (SEFAZ-MT)", { exact: false })).toBeVisible();

  await page.getByLabel("ICMS a recolher").fill("1.382,40");
  await page.getByLabel("Vencimento do ICMS").fill("2026-09-20");
  const pagar = await page.getByLabel("Pagar até").getAttribute("max");
  await page.getByLabel("Pagar até").fill(pagar!);
  await page.getByRole("button", { name: "Calcular multa e juros" }).click();
  await expect(page.getByText(/Total do DAR \(pagar até/)).toBeVisible({ timeout: 30_000 });
  // 20/09/2026 é domingo: o atraso conta a partir de segunda, 21/09
  await expect(page.getByText(/desde 21\/09\/2026/)).toBeVisible();

  await expect(page.getByText("Na demonstração o robô não acessa a SEFAZ-MT", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerar o DAR na SEFAZ-MT e publicar" })).toBeDisabled();
  const { count } = await servico!.from("dar_emissoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  expect(count ?? 0).toBe(0);
});

test("empresário não abre a tela do DAR", async ({ page }) => {
  test.skip(!empresaId, "Rode o seed da demonstração (Grãos Cerrado).");
  await entrar(page, `graos@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/calculos/efd`);
  await expect(page.getByText("A EFD ICMS/IPI é gerada pela equipe do escritório.")).toBeVisible();
  await expect(page.getByText("DAR do ICMS", { exact: false })).toHaveCount(0);
});
