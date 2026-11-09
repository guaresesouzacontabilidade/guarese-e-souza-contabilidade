import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * Robô do DARE da SEFAZ-TO: o administrador guarda o acesso (cifrado) nas
 * Integrações; fora do portal oficial o robô não acessa a SEFAZ-TO, e a tela
 * diz isso (nada é simulado). Na apuração do ICMS de uma empresa do Tocantins
 * do Simples aparece o DARE da complementação (receita 105, vencimento dia 9).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";
const PADARIA = "54753822-598d-466a-9081-1e62c86b49cc";

async function entrar(browser: Browser, quem: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.fill('input[name="email"]', `${quem}@${DOMINIO}`);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
  return page;
}

test("administrador guarda, testa e remove o acesso à SEFAZ-TO", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await entrar(browser, "admin");
  await page.goto("/escritorio/configuracoes?aba=integracoes");
  const card = page.locator("div.rounded-2xl").filter({ has: page.getByText("DARE da SEFAZ-TO (robô)", { exact: true }) }).last();
  await expect(card).toBeVisible({ timeout: 60_000 });
  // Começa limpo (remove um acesso que tenha sobrado de outro teste)
  if (await card.getByRole("button", { name: "Remover" }).isVisible()) {
    await card.getByRole("button", { name: "Remover" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remover" }).click();
    await expect(card.getByLabel("CPF ou e-mail")).toBeVisible({ timeout: 30_000 });
  }
  await expect(card.getByText("Desconectado", { exact: true })).toBeVisible();

  // CPF inválido não é aceito
  await card.getByLabel("CPF ou e-mail").fill("111.111.111-11");
  await card.getByLabel("Senha").fill("qualquer");
  await card.getByRole("button", { name: "Guardar acesso" }).click();
  await expect(card.getByText("CPF ou e-mail inválido.")).toBeVisible();

  await card.getByLabel("CPF ou e-mail").fill("529.982.247-25");
  await card.getByLabel("Senha").fill("senha-de-teste");
  await card.getByRole("button", { name: "Guardar acesso" }).click();
  await expect(page.getByText(/Acesso guardado \(cifrado\)/)).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText("***.982.247-**")).toBeVisible();
  await expect(card.getByText("Não testado", { exact: true })).toBeVisible();
  // A senha nunca volta para a página
  expect(await page.content()).not.toContain("senha-de-teste");

  // Fora do portal oficial o teste não acessa a SEFAZ-TO
  await expect(card.getByRole("button", { name: "Testar conexão" })).toBeDisabled();
  await expect(card.getByText("Fora do portal oficial o teste não acessa a SEFAZ-TO.")).toBeVisible();

  await card.getByRole("button", { name: "Remover" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remover" }).click();
  await expect(card.getByText("Desconectado", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.context().close();
});

test("apuração do ICMS (TO, Simples) mostra o DARE da complementação e não finge emitir", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await entrar(browser, "contador");
  await page.goto(`/e/${PADARIA}/calculos/icms?competencia=2026-10`);
  const card = page.locator("#dare-to");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("105 · Complementação de alíquota (Simples)")).toBeVisible();
  await expect(card.getByText("09/11/2026")).toBeVisible();
  await expect(card.getByText(/Fora do portal oficial \(demonstração ou teste\) o robô não acessa a SEFAZ-TO/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Emitir o DARE e publicar" })).toBeDisabled();
  await expect(card.getByRole("link", { name: "Emitir pelo site da SEFAZ-TO" })).toHaveAttribute("href", "https://dare.sefaz.to.gov.br");

  // Carteira: o quadro do DARE em lote aparece com o motivo de não emitir aqui
  await page.goto("/escritorio/icms?competencia=2026-10");
  const lote = page.locator("#dare-to-lote");
  await expect(lote).toBeVisible({ timeout: 90_000 });
  await expect(lote.getByText(/empresas? do Tocantins t[eê]m? complementação/)).toBeVisible();
  await page.context().close();
});
