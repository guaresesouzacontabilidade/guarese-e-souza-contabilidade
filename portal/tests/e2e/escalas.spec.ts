import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * Escalas de trabalho: o empresário vê a escala publicada da padaria, cadastra
 * um funcionário, monta a escala de um mês, marca dias na grade, vê a
 * conferência da CLT acusar o 7º dia seguido, salva e exclui. O assistente de
 * IA aparece desconectado (sem chave, nada é enviado). Quem não tem permissão
 * não vê a ferramenta.
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

test("empresário monta, confere e salva a escala; IA desconectada não envia nada", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await entrar(browser, "cliente");
  await page.goto(`/e/${PADARIA}/escalas`);
  await expect(page.getByRole("heading", { name: "Escalas de trabalho" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Desconectado até o administrador do escritório cadastrar a chave da Anthropic.")).toBeVisible();

  // Escala publicada da demonstração: grade, legenda e conferência
  await page.getByRole("link", { name: /Padaria — balcão e produção/ }).first().click();
  await expect(page.getByRole("table", { name: /Escala do mês/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /^Ana Souza \(DEMO\), \S+ 1:/ })).toBeVisible();
  await page.getByRole("tab", { name: "Assistente de IA" }).click();
  await expect(page.getByText("Desconectado até a ativação")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pedir ao assistente" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Conferência da CLT" }).click();
  await expect(page.getByText(/O portal confere jornada diária e semanal/)).toBeVisible();

  // Modelos de escala
  await page.goto(`/e/${PADARIA}/escalas/modelos`);
  for (const m of ["5x2", "6x1", "12x36", "24x48", "Turnos de revezamento", "Jornada parcial"]) await expect(page.getByRole("heading", { name: m, exact: true })).toBeVisible();
  await expect(page.locator("#\\32 4x48").getByText("Risco alto", { exact: true })).toBeVisible();

  // Cadastra um funcionário
  const nome = `Teste Escala ${Date.now().toString().slice(-6)}`;
  await page.goto(`/e/${PADARIA}/escalas/funcionarios`);
  await page.getByRole("button", { name: "Cadastrar funcionário" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Nome").fill(nome);
  await dialogo.getByLabel("Cargo").fill("Atendente");
  await dialogo.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByRole("cell", { name: nome, exact: true })).toBeVisible({ timeout: 30_000 });

  // Monta a escala de um mês sem escala
  await page.goto(`/e/${PADARIA}/escalas`);
  await page.getByRole("button", { name: "Nova escala" }).click();
  const nova = page.getByRole("dialog");
  await nova.getByLabel("Nome").fill(`E2E ${nome}`);
  await nova.getByLabel("Mês").fill("2030-03");
  await nova.getByRole("button", { name: "Montar a escala" }).click();
  await page.waitForURL(/\/escalas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: `E2E ${nome}` })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${nome}, `) }).first()).toBeVisible();

  // Marca 9 dias seguidos de manhã: a conferência acusa o 7º dia
  await page.getByRole("radio", { name: /Manhã/ }).click();
  for (let dia = 1; dia <= 9; dia++) await page.getByRole("button", { name: new RegExp(`^${nome}, \\S+ ${dia}:`) }).click();
  await page.getByRole("tab", { name: /Conferência da CLT/ }).click();
  await expect(page.getByText(new RegExp(`${nome}: 7º dia seguido de trabalho`)).first()).toBeVisible();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Escala salva.")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await page.getByRole("tab", { name: /Conferência da CLT/ }).click();
  await expect(page.getByText(new RegExp(`${nome}: 7º dia seguido de trabalho`)).first()).toBeVisible({ timeout: 30_000 });

  // Publicar com erro pede confirmação; depois exclui a escala de teste
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("alertdialog", { name: "Publicar com pontos fora da CLT?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Excluir escala" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
  await page.waitForURL(new RegExp(`/e/${PADARIA}/escalas$`), { timeout: 60_000 });

  // Remove o funcionário de teste
  await page.goto(`/e/${PADARIA}/escalas/funcionarios`);
  await page.getByRole("button", { name: `Remover ${nome}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remover" }).click();
  await expect(page.getByRole("cell", { name: nome, exact: true })).toHaveCount(0, { timeout: 30_000 });
});

test("colaborador sem permissão não vê a ferramenta; outra empresa também não", async ({ browser }) => {
  test.setTimeout(180_000);
  const colab = await entrar(browser, "colaborador");
  await colab.goto(`/e/${PADARIA}`);
  await expect(colab.locator(`a[href="/e/${PADARIA}/escalas"]`)).toHaveCount(0);
  const r = await colab.goto(`/e/${PADARIA}/escalas`);
  expect(r?.status()).toBe(404);
  const outro = await entrar(browser, "cliente2");
  const r2 = await outro.goto(`/e/${PADARIA}/escalas`);
  expect(r2?.status()).toBe(404);
});

test("administrador vê a IA desconectada em Integrações e a chave inválida é recusada", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await entrar(browser, "admin");
  await page.goto("/escritorio/configuracoes?aba=integracoes");
  const cartao = page.locator("div.rounded-2xl, div.rounded-xl").filter({ hasText: "Inteligência artificial (Claude, da Anthropic)" }).last();
  await expect(cartao.getByText("Desconectada", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(cartao.getByText(/não são usados para treinar a IA/)).toBeVisible();
  await cartao.getByLabel(/Chave da API da Anthropic/).fill("chave-errada");
  await cartao.getByRole("button", { name: "Guardar chave" }).click();
  await expect(cartao.getByText(/A chave da Anthropic começa com “sk-ant-”/)).toBeVisible({ timeout: 30_000 });
  await expect(cartao.getByLabel("Ligar o assistente nas escalas de trabalho")).toBeDisabled();
});
