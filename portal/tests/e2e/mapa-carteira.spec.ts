import { test, expect, type Page } from "@playwright/test";

/**
 * Mapa da carteira (dados fictícios da demonstração):
 *  - a equipe vê as empresas que atende com as 6 etapas do mês, abre o painel
 *    lateral de uma etapa, marca como concluída (com observação) e desfaz;
 *  - a ficha operacional da empresa mostra as etapas, o histórico dos meses e
 *    aceita anotações internas da equipe (escrever e apagar);
 *  - a planilha do mapa sai em Excel para a equipe;
 *  - o cliente não abre o mapa nem baixa a planilha.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    await page.waitForLoadState("networkidle");
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

async function abrirMapa(page: Page, caminho = "/escritorio/mapa") {
  await page.goto(caminho);
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 }), page.click('button[type="submit"]')]);
    await page.goto(caminho);
  }
}

test.describe.configure({ mode: "serial" });

test("equipe: mapa da carteira, painel lateral da etapa e marcação concluída", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `contador@${DOMINIO}`);
  await abrirMapa(page);
  await expect(page.getByRole("heading", { name: "Mapa da carteira" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atenção agora" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Todas as empresas/ })).toBeVisible();

  // Célula "Extrato e conciliação" da padaria fictícia
  const celula = page.locator("main").getByRole("button", { name: /^PADARIA.*Extrato e conciliação|^Padaria.*Extrato e conciliação/ }).first();
  await expect(celula).toBeVisible();
  await celula.click();
  const painel = page.getByRole("dialog");
  await expect(painel.getByText(/Etapa 3 de 6 · Extrato e conciliação/)).toBeVisible();
  await expect(painel.getByText("O QUE FAZER AGORA")).toBeVisible();

  // Marca como concluída, com observação
  await painel.getByRole("button", { name: "Marcar como concluída" }).click();
  const confirmar = page.getByRole("alertdialog");
  await confirmar.getByLabel("Observação (opcional)").fill("Conferido no extrato do banco (teste)");
  await confirmar.getByRole("button", { name: "Marcar como concluída" }).click();
  await expect(page.getByText("Etapa marcada como concluída").first()).toBeVisible();
  await expect(painel.getByText(/Concluído · Concluído/)).toBeVisible({ timeout: 30_000 });
  await expect(painel.getByText(/Conferido no extrato do banco \(teste\)/)).toBeVisible();

  // Desfaz a marcação
  await painel.getByRole("button", { name: "Desfazer a marcação" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText(/Marcação desfeita/).first()).toBeVisible();
  await expect(painel.getByRole("button", { name: "Marcar como concluída" })).toBeVisible({ timeout: 30_000 });

  // Filtros: "Com atraso" e "Minhas empresas"
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Minhas empresas/ }).click();
  await expect(page.getByRole("button", { name: /Minhas empresas/ })).toHaveAttribute("aria-pressed", "true");
});

test("equipe: ficha operacional da empresa com histórico e anotações", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `contador@${DOMINIO}`);
  await abrirMapa(page);
  const link = page.locator('main a[href^="/escritorio/mapa/"]').filter({ hasText: /padaria/i }).first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);
  await expect(page.getByRole("heading", { name: "Etapas do mês" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Como foi nos últimos meses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prazos deste mês" })).toBeVisible();

  const texto = `Cliente prefere ser cobrado por e-mail (teste ${Date.now()})`;
  await page.getByLabel("Nova anotação").fill(texto);
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect(page.getByText(texto)).toBeVisible({ timeout: 30_000 });
  const item = page.locator("li").filter({ hasText: texto });
  await item.getByRole("button", { name: "Apagar a anotação" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByText(texto)).toHaveCount(0, { timeout: 30_000 });
});

test("planilha do mapa para a equipe; o cliente não abre o mapa", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await entrar(page, `contador@${DOMINIO}`);
  const r = await page.request.get("/api/escritorio/mapa/planilha?competencia=2026-10");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("spreadsheetml");

  const ctx = await browser.newContext();
  const cliente = await ctx.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto("/escritorio/mapa");
  await expect(cliente).not.toHaveURL(/\/escritorio\/mapa/);
  const negado = await cliente.request.get("/api/escritorio/mapa/planilha?competencia=2026-10");
  // Sem acesso: sessão do cliente recusada (401) ou acesso negado (403); nunca a planilha
  expect([401, 403]).toContain(negado.status());
  await ctx.close();
});
