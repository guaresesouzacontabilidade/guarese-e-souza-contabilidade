import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Ferramentas por empresa (Cadastro da empresa → Ferramentas): a madeireira de
 * demonstração vem sem CT-e. O escritório vê a ferramenta desmarcada, o menu e o
 * painel da empresa não oferecem o CT-e e a tela avisa que está desligada; ao
 * religar, o CT-e volta ao menu. O cliente não vê a opção. Dados fictícios.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";

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

let empresaId = "";
let anteriores: string[] = [];

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, ferramentas_desligadas").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
  anteriores = data!.ferramentas_desligadas ?? [];
  // Começa como a demonstração: madeireira sem CT-e
  await servico!.from("empresas").update({ ferramentas_desligadas: [...new Set([...anteriores, "cte"])] }).eq("id", empresaId);
});

test.afterAll(async () => {
  await servico!.from("empresas").update({ ferramentas_desligadas: anteriores }).eq("id", empresaId);
});

test("escritório desliga e religa o CT-e da madeireira; o cliente não vê a opção", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await entrar(page, `contador@${DOMINIO}`);

  // Ferramenta desmarcada no cadastro
  await page.goto(`/escritorio/empresas/${empresaId}?aba=ferramentas`);
  await expect(page.getByRole("heading", { name: "Ferramentas desta empresa" })).toBeVisible();
  const cte = page.getByRole("checkbox", { name: /Emitir CT-e \(frete\)/ });
  await expect(cte).not.toBeChecked();

  // Sem CT-e no menu nem nos atalhos; a tela avisa
  await page.goto(`/e/${empresaId}`);
  await page.getByRole("button", { name: "Notas" }).first().click();
  await expect(page.getByRole("link", { name: "Emitir nota de produto" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Emitir CT-e/ })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/cte`);
  await expect(page.getByText("Emitir CT-e (frete): ferramenta desligada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cadastro da empresa → Ferramentas" })).toBeVisible();

  // Religa: o CT-e volta ao menu
  await page.goto(`/escritorio/empresas/${empresaId}?aba=ferramentas`);
  await page.getByRole("checkbox", { name: /Emitir CT-e \(frete\)/ }).check();
  await page.getByRole("button", { name: "Salvar ferramentas" }).click();
  await expect(page.getByText(/Ferramentas salvas/).first()).toBeVisible({ timeout: 30_000 });
  const { data: depois } = await servico!.from("empresas").select("ferramentas_desligadas").eq("id", empresaId).single();
  expect(depois!.ferramentas_desligadas).not.toContain("cte");
  await page.goto(`/e/${empresaId}`);
  await page.getByRole("button", { name: "Notas" }).first().click();
  await expect(page.getByRole("link", { name: "Emitir CT-e (frete)" }).first()).toBeVisible();

  // Desliga de novo pela tela
  await page.goto(`/escritorio/empresas/${empresaId}?aba=ferramentas`);
  await page.getByRole("checkbox", { name: /Emitir CT-e \(frete\)/ }).uncheck();
  await page.getByRole("button", { name: "Salvar ferramentas" }).click();
  await expect(page.getByText(/Ferramentas salvas/).first()).toBeVisible({ timeout: 30_000 });

  // O dono da madeireira não vê o CT-e e recebe o aviso de ferramenta fora do atendimento
  const ctx = await browser.newContext();
  const dono = await ctx.newPage();
  await entrar(dono, `madeireira@${DOMINIO}`);
  await dono.goto(`/e/${empresaId}/cte`);
  await expect(dono.getByText("Esta ferramenta não faz parte do atendimento da sua empresa.", { exact: false })).toBeVisible();
  await expect(dono.getByRole("link", { name: /Emitir CT-e/ })).toHaveCount(0);
  await ctx.close();
});
