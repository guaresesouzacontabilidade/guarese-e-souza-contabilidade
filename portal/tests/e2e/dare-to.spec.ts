import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * Robô do DARE avulso da SEFAZ-TO (sem login): na apuração do ICMS de uma
 * empresa do Tocantins do Simples aparece o DARE da complementação (receita
 * 105, vencimento dia 9). Fora do portal oficial o robô não acessa a SEFAZ-TO
 * e a tela diz isso (nada é simulado).
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
  await expect(card.getByRole("link", { name: "Emitir pelo site da SEFAZ-TO" })).toHaveAttribute("href", "https://www.sefaz.to.gov.br/dare/servlet/hnetccwkda");
  await page.goto("/escritorio/icms?competencia=2026-10");
  const lote = page.locator("#dare-to-lote");
  await expect(lote).toBeVisible({ timeout: 90_000 });
  await expect(lote.getByText(/empresas? do Tocantins t[eê]m? complementação/)).toBeVisible();
  await page.context().close();
});
