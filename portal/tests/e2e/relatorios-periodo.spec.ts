import { test, expect, type Page } from "@playwright/test";

/**
 * Relatórios com período personalizado ("de um mês até outro"), na tela e na
 * exportação. Usa os dados fictícios de `npm run seed:demo`.
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

function mes(deslocamento: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamento);
  return d.toISOString().slice(0, 7);
}

test("DRE de um mês até outro, na tela e no Excel", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/[0-9a-f-]{36}/)![0];

  await page.goto(`${empresa}/relatorios/dre`);
  await page.selectOption("#periodo", "__intervalo");
  await page.selectOption("#periodo-de", mes(-5));
  await page.selectOption("#periodo-ate", mes(-1));
  await page.getByRole("button", { name: "Ver período" }).click();
  await page.waitForURL(new RegExp(`periodo=${mes(-5)}_${mes(-1)}`), { timeout: 60_000 });
  // Cinco meses + total na tabela
  await expect(page.locator("#periodo-de")).toHaveValue(mes(-5));

  const excel = page.getByRole("link", { name: /Excel/ }).first();
  const href = await excel.getAttribute("href");
  expect(href).toContain(`periodo=${mes(-5)}_${mes(-1)}`);
  const resposta = await page.request.get(href!);
  expect(resposta.status()).toBe(200);
  expect(resposta.headers()["content-type"]).toContain("spreadsheet");
});
