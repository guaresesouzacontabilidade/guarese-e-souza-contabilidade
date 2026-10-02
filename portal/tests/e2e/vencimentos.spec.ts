import { test, expect, type Page } from "@playwright/test";

/**
 * Vencimentos (certificados, alvarás, licenças e certidões): o cliente vê e
 * cadastra os da própria empresa; o escritório acompanha a carteira.
 * Usa os dados fictícios de `npm run seed:demo`.
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

test("cliente acompanha e cadastra vencimentos; escritório vê a carteira", async ({ page, browser }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/[0-9a-f-]{36}/)![0];

  // Alerta na visão geral
  await expect(page.getByText("Documentos vencendo")).toBeVisible();

  await page.goto(`${empresa}/vencimentos`);
  await expect(page.getByText("Certificado digital A1 (e-CNPJ)")).toBeVisible();
  await expect(page.getByText(/Vencido há 3 dias/)).toBeVisible();

  // Novo vencimento
  const descricao = `Licença do bombeiro ${Date.now()}`;
  await page.getByRole("button", { name: "Novo vencimento" }).first().click();
  await page.selectOption("#vc-tipo", "licenca_bombeiros");
  await page.fill("#vc-desc", descricao);
  await page.fill("#vc-validade", "2027-03-31");
  await page.getByRole("dialog").getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText(/Vencimento cadastrado/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(descricao)).toBeVisible();

  // Arquiva o registro de teste (cliente não exclui)
  await page.getByRole("button", { name: `Ações para ${descricao}` }).click();
  await expect(page.getByRole("menuitem", { name: "Excluir" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /Arquivar/ }).click();
  await expect(page.getByText(/Arquivado: não gera mais avisos/)).toBeVisible({ timeout: 30_000 });

  // Escritório: carteira
  const ctx = await browser.newContext({ baseURL: process.env.PORTAL_URL ?? "http://localhost:3000", locale: "pt-BR" });
  const escritorio = await ctx.newPage();
  await entrar(escritorio, `contador@${DOMINIO}`);
  await escritorio.goto("/escritorio/vencimentos");
  await expect(escritorio.getByText("Vencimentos da carteira")).toBeVisible();
  await expect(escritorio.getByText("CND Federal (Receita e PGFN)").first()).toBeVisible();

  // Exclui o registro de teste
  await escritorio.goto(`${empresa}/vencimentos`);
  await escritorio.getByRole("button", { name: `Ações para ${descricao}` }).click();
  await escritorio.getByRole("menuitem", { name: "Excluir" }).click();
  await escritorio.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(escritorio.getByText(descricao)).toHaveCount(0, { timeout: 30_000 });
  await ctx.close();
});
