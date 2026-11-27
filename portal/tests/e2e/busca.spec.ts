import { test, expect, type Page } from "@playwright/test";

/**
 * Busca do portal (dados fictícios da demonstração):
 *  - nas listas, os resultados aparecem enquanto a pessoa digita, sem acento,
 *    com as palavras em qualquer ordem e CPF/CNPJ com ou sem pontos;
 *  - a busca geral (Ctrl+K) acha telas e os dados da empresa aberta e leva
 *    direto à ficha;
 *  - o cliente de outra empresa não acha nada da madeireira.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

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

async function abrirBuscaGeral(page: Page) {
  await page.getByRole("button", { name: "Buscar no portal" }).click();
  const caixa = page.getByRole("combobox", { name: "O que você procura?" });
  await expect(caixa).toBeFocused();
  return caixa;
}

test("escritório: lista de empresas busca enquanto digita, sem acento e pelo CNPJ com pontos", async ({ page }) => {
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio/empresas");
  const busca = page.getByLabel("Buscar empresa").first();
  await busca.fill("reflorestar madeireira");
  // Sem apertar Enter: o endereço muda e a lista se atualiza
  await page.waitForURL(/busca=reflorestar/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Madeireira Reflorestar/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /PADARIA/i })).toHaveCount(0);

  await busca.fill("33.444.555/0001-81");
  await page.waitForURL(/busca=33\.444/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Madeireira Reflorestar/i }).first()).toBeVisible();

  // Limpar volta a lista inteira
  await page.getByRole("button", { name: "Limpar a busca" }).first().click();
  await page.waitForURL((u) => !u.searchParams.get("busca"), { timeout: 15_000 });
  await expect(page.getByRole("link", { name: /PADARIA/i }).first()).toBeVisible();
});

test("loja: clientes por nome em qualquer ordem e busca geral (Ctrl+K) leva à ficha e às telas", async ({ page }) => {
  await entrar(page, `madeireira@${DOMINIO}`);
  const empresa = /\/e\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(empresa).toBeTruthy();

  await page.goto(`/e/${empresa}/loja/clientes`);
  await page.getByLabel("Buscar cliente").fill("CARPINTEIRO joão");
  await page.waitForURL(/q=CARPINTEIRO/, { timeout: 15_000 });
  await expect(page.getByRole("row", { name: /João Carpinteiro/ })).toBeVisible();

  // Busca geral pelo atalho do teclado: sem acento, palavras fora de ordem
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("Control+k");
  let caixa = page.getByRole("combobox", { name: "O que você procura?" });
  await expect(caixa).toBeFocused();
  await caixa.fill("carpinteiro joao");
  const opcao = page.getByRole("option", { name: /João Carpinteiro Exemplo/ }).first();
  await expect(opcao).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Clientes e fornecedores", { exact: true })).toBeVisible();
  await caixa.press("Enter");
  await page.waitForURL(new RegExp(`/e/${empresa}/loja/clientes/[0-9a-f-]{36}`), { timeout: 30_000 });

  // CPF com pontos e o nome de uma tela
  caixa = await abrirBuscaGeral(page);
  await caixa.fill("147.258.369-82");
  await expect(page.getByRole("option", { name: /João Carpinteiro Exemplo/ }).first()).toBeVisible({ timeout: 20_000 });
  await caixa.fill("contas pagar");
  await page.getByRole("option", { name: /Contas a pagar/ }).first().click();
  await page.waitForURL(new RegExp(`/e/${empresa}/financeiro/pagar`), { timeout: 30_000 });
});

test("isolamento: o cliente da padaria não acha nada da madeireira na busca geral", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  const caixa = await abrirBuscaGeral(page);
  await caixa.fill("Carpinteiro");
  await expect(page.getByText(/Nada encontrado para “Carpinteiro”/)).toBeVisible({ timeout: 20_000 });
  await caixa.fill("Madeireira Reflorestar");
  await expect(page.getByText(/Nada encontrado/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("option", { name: /Madeireira/i })).toHaveCount(0);
});
