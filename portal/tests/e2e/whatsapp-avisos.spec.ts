import { test, expect, type Page } from "@playwright/test";

/**
 * WhatsApp para os avisos do cliente: o escritório cadastra o número com a
 * autorização; o próprio cliente liga ou desliga em Minha conta; a
 * configuração da integração fica em Configurações → Lembretes.
 * Usa os usuários fictícios de `npm run seed:demo`.
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

test("escritório cadastra o WhatsApp do cliente e o cliente controla os avisos", async ({ page: escritorio, browser }) => {
  await entrar(escritorio, `admin@${DOMINIO}`);

  // Configuração da integração
  await escritorio.goto("/escritorio/configuracoes?aba=lembretes");
  await expect(escritorio.getByText("Avisos ao cliente por WhatsApp")).toBeVisible();
  await expect(escritorio.getByLabel("Nome do modelo de aviso aprovado")).toBeVisible();

  // Cliente da Padaria na lista de usuários da empresa
  const contextoCliente = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const cliente = await contextoCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresaId = cliente.url().match(/\/e\/([0-9a-f-]{36})/)![1];

  await escritorio.goto(`/escritorio/empresas/${empresaId}?aba=usuarios`);
  const linha = escritorio.locator("tr", { hasText: `cliente@${DOMINIO}` });
  await linha.getByRole("button", { name: /Ações para/ }).click();
  await escritorio.getByRole("menuitem", { name: "WhatsApp para avisos" }).click();
  await escritorio.getByLabel("WhatsApp (com DDD)").fill("(63) 99999-1234");
  await escritorio.getByRole("dialog").getByRole("checkbox").check();
  await escritorio.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(escritorio.getByText("WhatsApp salvo")).toBeVisible({ timeout: 30_000 });
  await expect(linha).toContainText("(63) 99999-1234 · recebe avisos");

  // O cliente vê a opção ligada em Minha conta e pode desligar
  await cliente.goto("/conta#avisos");
  const opcao = cliente.locator('input[name="whatsapp_avisos"]');
  await expect(opcao).toBeChecked();
  await expect(cliente.getByText("No número (63) 99999-1234")).toBeVisible();
  await opcao.uncheck();
  await cliente.locator("#avisos").getByRole("button", { name: "Salvar" }).click();
  await expect(cliente.getByText("Preferências salvas")).toBeVisible({ timeout: 30_000 });

  await escritorio.reload();
  await expect(escritorio.locator("tr", { hasText: `cliente@${DOMINIO}` })).toContainText("sem autorização para avisos");

  // Volta ao estado original da demonstração (sem WhatsApp cadastrado)
  await escritorio.locator("tr", { hasText: `cliente@${DOMINIO}` }).getByRole("button", { name: /Ações para/ }).click();
  await escritorio.getByRole("menuitem", { name: "WhatsApp para avisos" }).click();
  await escritorio.getByLabel("WhatsApp (com DDD)").fill("");
  await escritorio.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(escritorio.locator("tr", { hasText: `cliente@${DOMINIO}` })).toContainText("WhatsApp não cadastrado", { timeout: 30_000 });
  await contextoCliente.close();
});
