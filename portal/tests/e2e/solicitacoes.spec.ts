import { test, expect, type Page } from "@playwright/test";

/**
 * Solicitações de serviço: o cliente abre, o escritório pede um documento e o
 * cliente vê a mudança na hora (sem recarregar). Usa os dados fictícios de
 * `npm run seed:demo` (o teste cancela a solicitação no fim).
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

test("cliente abre solicitação e acompanha o andamento ao vivo", async ({ page: cliente, browser }) => {
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = cliente.url().match(/\/e\/[0-9a-f-]{36}/)![0];

  await cliente.goto(`${empresa}/solicitacoes/nova`);
  await cliente.getByText("Declaração de faturamento", { exact: true }).click();
  await expect(cliente.getByText("Costuma ser preciso:")).toBeVisible();
  const titulo = `Declaração para o banco ${Date.now()}`;
  await cliente.fill("#sol-titulo", titulo);
  await cliente.fill("#sol-desc", "Últimos 12 meses, para financiamento.");
  await cliente.getByRole("button", { name: "Abrir solicitação" }).click();
  await cliente.waitForURL(/\/solicitacoes\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const url = new URL(cliente.url()).pathname;
  await expect(cliente.getByText("Solicitação aberta")).toBeVisible();
  await cliente.waitForTimeout(1500); // canal de tempo real conectado

  // Escritório pede um documento
  const ctx = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const escritorio = await ctx.newPage();
  await entrar(escritorio, `contador@${DOMINIO}`);
  await escritorio.goto("/escritorio/solicitacoes");
  await expect(escritorio.getByText(titulo)).toBeVisible();
  await escritorio.goto(url);
  await escritorio.selectOption("#and-status", "aguardando_cliente");
  await escritorio.fill("#and-com", "Envie o faturamento de setembro, por favor.");
  await escritorio.getByRole("button", { name: "Atualizar" }).click();
  await expect(escritorio.getByText("Solicitação atualizada.")).toBeVisible({ timeout: 30_000 });

  // O cliente vê sem recarregar
  await expect(cliente.getByText("Envie o faturamento de setembro, por favor.")).toBeVisible({ timeout: 20_000 });
  await expect(cliente.getByText("Aguardando a empresa").first()).toBeVisible();

  // Cliente cancela (limpeza)
  await cliente.getByRole("button", { name: "Cancelar solicitação" }).click();
  await cliente.fill("#cli-com", "Teste automático concluído.");
  await cliente.getByRole("button", { name: "Cancelar solicitação" }).last().click();
  await expect(cliente.getByText("Solicitação atualizada.")).toBeVisible({ timeout: 30_000 });
  await expect(cliente.getByText("Situação alterada: Cancelada")).toBeVisible();
  await ctx.close();
});
