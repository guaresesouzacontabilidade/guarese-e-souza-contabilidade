import { test, expect, type Page } from "@playwright/test";

/**
 * Auditor fiscal: a equipe abre o painel da carteira, analisa a Padaria de
 * demonstração (notas fictícias de bebidas monofásicas e com ICMS-ST), confere
 * a memória de cálculo e publica um achado; o empresário vê a oportunidade
 * (sem a parte técnica interna) e o botão para pedir ajuda; no fim a equipe
 * retira a publicação, deixando a demonstração como estava.
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

test("equipe analisa e publica; o cliente vê a oportunidade; a equipe retira", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctxEquipe = await browser.newContext({ locale: "pt-BR" });
  const equipe = await ctxEquipe.newPage();
  await entrar(equipe, `contador@${DOMINIO}`);
  await equipe.goto("/escritorio/auditor-fiscal");
  await expect(equipe.getByRole("heading", { name: "Auditor fiscal" })).toBeVisible();
  await expect(equipe.getByText("Produtos com PIS/Cofins monofásico usados pelo auditor")).toBeVisible();
  await equipe.getByRole("link", { name: /Padaria Pão Dourado/ }).first().click();
  await equipe.waitForURL(/\/e\/[0-9a-f-]{36}\/auditor-fiscal/);

  const mono = equipe.locator('[data-achado="monofasico_simples"]');
  if (!(await mono.first().isVisible().catch(() => false))) {
    await equipe.getByRole("button", { name: "Analisar agora" }).click();
    await expect(mono.first()).toBeVisible({ timeout: 180_000 });
  }
  const card = mono.first();
  const titulo = (await card.getByRole("heading").first().innerText()).trim();
  await card.getByText("Memória de cálculo, notas e base legal").click();
  await expect(card.getByText("Parcela de PIS + Cofins dentro do DAS")).toBeVisible();
  await expect(card.getByRole("link", { name: /LC nº 123\/2006/ })).toBeVisible();
  await expect(card.getByRole("link", { name: /NFC-e/ }).first()).toBeVisible();

  await card.getByRole("button", { name: "Publicar ao cliente" }).click();
  const dialogo = equipe.getByRole("dialog");
  await expect(dialogo.locator("textarea")).toHaveValue(/impostos que podem ter sido pagos a mais/);
  await dialogo.getByRole("button", { name: "Publicar" }).click();
  await expect(equipe.getByText(/Publicado ao cliente\. Ele recebe/)).toBeVisible({ timeout: 30_000 });

  const ctxCliente = await browser.newContext({ locale: "pt-BR" });
  const cliente = await ctxCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await cliente.getByRole("link", { name: "Economia de impostos" }).first().click();
  await expect(cliente.getByRole("heading", { name: "Economia de impostos" })).toBeVisible();
  await expect(cliente.getByText(/impostos que podem ter sido pagos a mais/).first()).toBeVisible();
  await expect(cliente.getByText(/Prazo para pedir de volta/).first()).toBeVisible();
  await expect(cliente.getByRole("button", { name: "Quero que o escritório cuide disso" }).first()).toBeVisible();
  await expect(cliente.getByText("Memória de cálculo, notas e base legal")).toHaveCount(0);

  await equipe.goto(`${equipe.url().replace(/\?.*$/, "")}?situacao=publicados`);
  const publicado = equipe.locator('[data-achado="monofasico_simples"]').filter({ hasText: titulo });
  await publicado.getByRole("button", { name: "Retirar do cliente" }).click();
  await expect(equipe.getByText("Retirado do cliente. O achado voltou para a equipe.")).toBeVisible({ timeout: 30_000 });
  await ctxEquipe.close();
  await ctxCliente.close();
});
