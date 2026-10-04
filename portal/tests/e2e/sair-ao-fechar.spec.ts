import { test, expect, type Page } from "@playwright/test";

/**
 * Fechar o portal encerra a sessão: com todas as abas fechadas, quem abrir o
 * portal de novo cai no login. Recarregar a página, abrir outra aba ou fechar
 * só uma das abas abertas não desconecta.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("fechar o portal pede login de novo; recarregar e outras abas não desconectam", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const aba1 = await ctx.newPage();
  await entrar(aba1, `contador@${DOMINIO}`);
  await aba1.goto("/escritorio/empresas");
  await expect(aba1.getByRole("heading", { name: "Empresas" })).toBeVisible({ timeout: 90_000 });

  // Recarregar não desconecta
  await aba1.reload();
  await expect(aba1).toHaveURL(/\/escritorio\/empresas/);

  // Outra aba com o portal aberto: continua conectado
  const aba2 = await ctx.newPage();
  await aba2.goto("/escritorio/empresas");
  await expect(aba2).toHaveURL(/\/escritorio\/empresas/);

  // Fechar só uma das abas: a outra renova o sinal e segue conectada
  await aba2.close({ runBeforeUnload: true });
  await esperar(7_000);
  await aba1.reload();
  await expect(aba1).toHaveURL(/\/escritorio\/empresas/);

  // Fechar todas: reabrir depois de alguns segundos pede login, com o aviso
  await aba1.close({ runBeforeUnload: true });
  await esperar(7_000);
  const nova = await ctx.newPage();
  await nova.goto("/escritorio/empresas");
  await expect(nova).toHaveURL(/\/login\?motivo=fechado/, { timeout: 60_000 });
  await expect(nova.getByText("Por segurança, a sessão foi encerrada porque o portal foi fechado. Entre novamente.")).toBeVisible();

  // A sessão foi encerrada de verdade: recriar o sinal à mão não devolve o acesso
  await ctx.addCookies([{ name: "portal_aberto", value: "1", url: BASE }]);
  await nova.goto("/escritorio/empresas");
  await expect(nova).toHaveURL(/\/login/);
  await ctx.close();
});
