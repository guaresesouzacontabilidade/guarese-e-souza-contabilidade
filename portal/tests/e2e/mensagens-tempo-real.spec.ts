import { test, expect, type Page } from "@playwright/test";

/**
 * Bate-papo em tempo real: cliente e escritório veem a mensagem do outro
 * chegar sem atualizar a página. Usa os usuários fictícios de `npm run seed:demo`.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

test("mensagens chegam na hora para o cliente e para o escritório", async ({ page: cliente, browser }) => {
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = cliente.url().match(/\/e\/[0-9a-f-]{36}/)![0];

  // Cliente abre uma conversa nova
  await cliente.goto(`${empresa}/mensagens`);
  await cliente.getByRole("button", { name: "Nova conversa" }).click();
  const assunto = `Tempo real ${Date.now()}`;
  await cliente.fill("#nc-assunto", assunto);
  await cliente.fill("#nc-corpo", "Olá! Primeira mensagem.");
  await cliente.getByRole("dialog").getByRole("button", { name: "Enviar" }).click();
  await cliente.waitForURL(/\/mensagens\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const conversa = new URL(cliente.url()).pathname;

  // Escritório abre a mesma conversa em outra janela
  const contexto = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const escritorio = await contexto.newPage();
  await entrar(escritorio, `contador@${DOMINIO}`);
  await escritorio.goto(conversa);
  await expect(escritorio.getByText("Olá! Primeira mensagem.")).toBeVisible();
  await escritorio.waitForTimeout(1500); // canal de tempo real conectado

  // Cliente responde → aparece para o escritório sem recarregar
  await cliente.getByLabel("Sua resposta").fill("Mensagem do cliente ao vivo");
  await cliente.getByRole("button", { name: "Enviar" }).click();
  await expect(escritorio.getByText("Mensagem do cliente ao vivo")).toBeVisible({ timeout: 15_000 });

  // Escritório responde → aparece para o cliente sem recarregar
  await escritorio.getByLabel("Sua resposta").fill("Resposta do escritório ao vivo");
  await escritorio.getByRole("button", { name: "Enviar" }).click();
  await expect(cliente.getByText("Resposta do escritório ao vivo")).toBeVisible({ timeout: 15_000 });
  await contexto.close();
});
