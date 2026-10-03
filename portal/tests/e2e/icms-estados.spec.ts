import { test, expect, type Page } from "@playwright/test";

/**
 * ICMS por estado (Obrigações): tabela dos 27 estados com a fonte de cada dado,
 * consulta entre estados (interestadual e diferencial), matriz interestadual;
 * só o administrador edita (e o prazo conferido exige o dia); a equipe consulta;
 * o cliente não acessa a camada interna de obrigações.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

test("ICMS por estado: consulta, matriz interestadual e edição só pelo administrador", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await entrar(page, `admin@${DOMINIO}`);
  await page.goto("/escritorio/obrigacoes");
  await page.getByRole("link", { name: "ICMS por estado" }).click();
  await page.waitForURL(/\/escritorio\/obrigacoes\/icms$/);
  await expect(page.getByRole("heading", { name: "ICMS por estado" })).toBeVisible();

  // Tabela: Tocantins com 20% conferidos e prazo a conferir; Bahia com dia 9 aguardando validação
  const to = page.locator("#uf-TO");
  await expect(to).toContainText("20%");
  await expect(to).toContainText("Conferida na lei");
  await expect(to).toContainText("A conferir");
  const ba = page.locator("#uf-BA");
  await expect(ba).toContainText("Dia 9 do mês seguinte");
  await expect(ba).toContainText("Regra aguardando validação");
  await expect(page.locator("#uf-MS")).toContainText("Datas do calendário fiscal do estado");

  // Consulta entre estados
  const resultado = page.locator("#sim-resultado");
  await page.selectOption("#sim-origem", "TO");
  await page.selectOption("#sim-destino", "SP");
  await expect(resultado).toContainText("12%");
  await page.selectOption("#sim-origem", "SP");
  await page.selectOption("#sim-destino", "TO");
  await expect(resultado).toContainText("7%");
  await expect(resultado).toContainText("13%"); // 20% do TO - 7%
  await page.getByLabel("Mercadoria importada (origem 1, 2, 3 ou 8)").check();
  await expect(resultado).toContainText("4%");
  await expect(resultado).toContainText("16%");
  await page.selectOption("#sim-destino", "SP");
  await expect(resultado).toContainText("Operação interna em SP");

  // Matriz interestadual
  const matriz = page.getByRole("region", { name: "Matriz de alíquotas interestaduais" });
  await expect(matriz).toBeVisible();
  await expect(matriz.locator('td[title="SP → TO: 7%"]')).toHaveText("7");
  await expect(matriz.locator('td[title="TO → SP: 12%"]')).toHaveText("12");

  // Administrador: prazo conferido exige o dia
  await to.getByRole("button", { name: "Editar Tocantins" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText("ICMS de Tocantins (TO)")).toBeVisible();
  await dialogo.locator("#vencimento_situacao").selectOption("conferido");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(dialogo.getByText("Informe o dia (1 a 31).")).toBeVisible();
  await dialogo.getByRole("button", { name: "Fechar" }).click();
  await expect(to).toContainText("A conferir");

  // Equipe consulta sem editar
  const ctxEquipe = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const equipe = await ctxEquipe.newPage();
  await entrar(equipe, `contador@${DOMINIO}`);
  await equipe.goto("/escritorio/obrigacoes/icms");
  await expect(equipe.getByRole("heading", { name: "ICMS por estado" })).toBeVisible();
  await expect(equipe.locator("#uf-SP")).toContainText("18%");
  await expect(equipe.getByRole("button", { name: /^Editar / })).toHaveCount(0);
  await ctxEquipe.close();

  // Cliente não acessa a camada interna de obrigações
  const ctxCliente = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const cliente = await ctxCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto("/escritorio/obrigacoes/icms");
  await expect(cliente).not.toHaveURL(/\/escritorio\/obrigacoes\/icms/);
  await ctxCliente.close();
});
