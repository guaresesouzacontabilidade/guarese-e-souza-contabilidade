import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Atualização automática (sem F5): o cliente cadastrado na hora, dentro do
 * caixa, aparece na lista de Clientes ao voltar pelo navegador — e o
 * fornecedor cadastrado no Financeiro aparece na lista de Fornecedores da
 * loja. (Dados fictícios da Madeireira.)
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
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
let empresaId = "";
const sufixo = String(Date.now() % 1_000_000);

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
});

test.afterAll(async () => {
  await servico!.from("contrapartes").delete().eq("empresa_id", empresaId).like("nome", `%E2E F5 ${sufixo}%`);
});

test("cliente cadastrado no caixa aparece na lista de clientes ao voltar, sem F5", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, "madeireira@demo.guareses.test");
  // Caixa aberto para poder cadastrar pelo ponto de venda
  await page.goto(`/e/${empresaId}/loja/vender`);
  const abrir = page.getByRole("button", { name: "Abrir o caixa" });
  if (await abrir.isVisible().catch(() => false)) {
    await page.getByLabel("Nome do caixa").fill("Caixa E2E F5");
    await page.getByLabel("Troco inicial na gaveta").fill("50,00");
    await abrir.click();
  }
  await expect(page.getByLabel("Buscar produto")).toBeVisible({ timeout: 30_000 });

  // 1) Abre a lista de clientes (fica guardada no navegador) e vai ao caixa pelo menu
  await page.goto(`/e/${empresaId}/loja/clientes`);
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("navigation").getByRole("link", { name: "Vender", exact: true }).first().click();
  await expect(page.getByLabel("Buscar produto")).toBeVisible({ timeout: 30_000 });

  // 2) Cadastra o cliente na hora
  const nome = `Cliente E2E F5 ${sufixo}`;
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nome").fill(nome);
  await d.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

  // 3) Volta pelo navegador: a lista já mostra o cliente novo
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("linha-cadastro").filter({ hasText: nome })).toHaveCount(1, { timeout: 15_000 });
});

test("fornecedor cadastrado no Financeiro aparece nos fornecedores da loja, sem F5", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, "madeireira@demo.guareses.test");
  await page.goto(`/e/${empresaId}/loja/fornecedores`);
  await expect(page.getByRole("heading", { name: "Fornecedores", level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.goto(`/e/${empresaId}/financeiro/cadastros?aba=contrapartes`);
  const nome = `Fornecedor E2E F5 ${sufixo}`;
  await page.getByRole("button", { name: "Novo cadastro" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel(/Nome/).first().fill(nome);
  await d.getByRole("button", { name: /Salvar|Cadastrar|Criar/ }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Fornecedores", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("linha-cadastro").filter({ hasText: nome })).toHaveCount(1, { timeout: 15_000 });
});
