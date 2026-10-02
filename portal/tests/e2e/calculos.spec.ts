import { test, expect, type Page } from "@playwright/test";

/**
 * Cálculos: previsão de impostos (liberada ao cliente só com os documentos do
 * mês enviados), simulação de rescisão e acesso restrito. Usa os dados
 * fictícios de `npm run seed:demo`.
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

function competencia(deslocamento: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamento);
  return d.toISOString().slice(0, 7);
}

test("cliente vê a previsão do mês com documentos completos e simula rescisões", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/[0-9a-f-]{36}/)![0];

  // Mês anterior com documentos faltando: a previsão ainda não aparece
  await page.goto(`${empresa}/calculos`);
  await expect(page.getByText(/aparece assim que os documentos do mês forem enviados/)).toBeVisible();

  // Dois meses atrás (documentos concluídos): previsão com o DAS
  await page.goto(`${empresa}/calculos?competencia=${competencia(-2)}`);
  await expect(page.getByText("DAS — Simples Nacional").first()).toBeVisible();
  await expect(page.getByText("Total estimado")).toBeVisible();
  await expect(page.getByText("INSS e IRRF da folha").first()).toBeVisible();

  // Rescisão de todos os colaboradores
  await page.goto(`${empresa}/calculos/rescisao`);
  await page.getByText("Todos os colaboradores").click();
  await expect(page.getByText(/3 colaboradores · Dispensa sem justa causa/)).toBeVisible();
  await page.getByRole("button", { name: "Carla Mendes (DEMO)" }).click();
  await expect(page.getByText("Férias vencidas", { exact: true })).toBeVisible();
  await expect(page.getByText("Custo total estimado")).toBeVisible();

  // Simulação avulsa
  await page.getByText("Simulação avulsa (sem cadastro)").click();
  await page.fill("#rs-sal", "3000");
  await page.fill("#rs-adm", "2023-03-10");
  await expect(page.getByText("Custo total estimado")).toBeVisible();
});

test("escritório configura os cálculos e vê a previsão mesmo com documentos faltando", async ({ page, browser }) => {
  await entrar(page, `contador@${DOMINIO}`);
  const cliente = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const pc = await cliente.newPage();
  await entrar(pc, `cliente@${DOMINIO}`);
  await pc.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = pc.url().match(/\/e\/[0-9a-f-]{36}/)![0];
  await cliente.close();

  await page.goto(`${empresa}/calculos`);
  await expect(page.getByText(/O cliente ainda não vê esta previsão/)).toBeVisible();
  await expect(page.getByText("DAS — Simples Nacional").first()).toBeVisible();

  await page.goto(`${empresa}/calculos/configuracao`);
  await expect(page.getByText("Parâmetros da empresa")).toBeVisible();
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText("Configuração dos cálculos salva.")).toBeVisible({ timeout: 30_000 });
});

test("colaborador do cliente sem acesso não vê os cálculos", async ({ page }) => {
  await entrar(page, `colaborador@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/[0-9a-f-]{36}/)![0];
  await expect(page.getByRole("link", { name: "Cálculos" })).toHaveCount(0);
  await page.goto(`${empresa}/calculos/colaboradores`);
  await expect(page.getByText("Seu acesso não inclui os cálculos desta empresa.")).toBeVisible();
  await expect(page.getByText("Ana Souza (DEMO)")).toHaveCount(0);
});

test("escritório compara os regimes com as premissas; cliente não acessa o comparativo", async ({ page, browser }) => {
  const cliente = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const pc = await cliente.newPage();
  await entrar(pc, `cliente@${DOMINIO}`);
  await pc.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = pc.url().match(/\/e\/[0-9a-f-]{36}/)![0];
  await pc.goto(`${empresa}/calculos/comparativo`);
  await expect(pc.getByText("Somente a equipe do escritório usa o comparativo de regimes.")).toBeVisible();
  await expect(pc.getByRole("link", { name: "Comparativo de regimes" })).toHaveCount(0);
  await cliente.close();

  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`${empresa}/calculos/comparativo`);
  await expect(page.getByRole("heading", { name: "Comparativo de regimes" })).toBeVisible();
  await expect(page.getByText("Regime atual", { exact: true })).toBeVisible();
  await expect(page.getByText(/Falta informar a margem de lucro/)).toBeVisible();

  await page.fill("#cmp-margem", "10");
  await page.fill("#cmp-icms", "18");
  await page.getByRole("button", { name: "Recalcular" }).click();
  await page.waitForURL(/margem=10/, { timeout: 60_000 });
  await expect(page.getByText("Menor custo estimado", { exact: true })).toBeVisible();
  await expect(page.getByText("falta premissa")).toHaveCount(0);
  await expect(page.getByText("Tributos por regime")).toBeVisible();
  await expect(page.getByText("Mês a mês", { exact: true })).toBeVisible();
});
