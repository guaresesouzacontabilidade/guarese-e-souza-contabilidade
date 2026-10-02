import { test, expect, type Page } from "@playwright/test";

/**
 * Isolamento entre clientes: cada cliente só vê a própria empresa.
 * Usa os usuários fictícios criados por `npm run seed:demo`.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname.startsWith("/aceite") || /^\/e\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return /\/e\/([0-9a-f-]{36})/.exec(page.url())![1];
}

test("cliente de uma empresa não acessa dados de outra", async ({ browser }) => {
  // Descobre a empresa e um documento do cliente 1 (Padaria)
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const empresa1 = await entrar(p1, `cliente@${DOMINIO}`);
  await p1.goto(`/e/${empresa1}/documentos`);
  const link = p1.locator("table a[href*='/documentos/']").first();
  const docHref = (await link.count()) ? await link.getAttribute("href") : null;
  const documento1 = docHref ? /documentos\/([0-9a-f-]{36})/.exec(docHref)?.[1] ?? null : null;
  await ctx1.close();

  // Cliente 2 (Oficina) tenta acessar a empresa e os arquivos do cliente 1
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const empresa2 = await entrar(p2, `cliente2@${DOMINIO}`);
  expect(empresa2).not.toBe(empresa1);

  for (const rota of ["", "/documentos", "/pendencias", "/financeiro", "/financeiro/lancamentos", "/conciliacao", "/conciliacao?aba=saldos", "/mensagens", "/enviar"]) {
    const r = await p2.goto(`/e/${empresa1}${rota}`);
    expect(r?.status(), `rota ${rota || "/"} deve responder 404`).toBe(404);
  }
  if (documento1) {
    const r = await p2.request.get(`/api/documentos/${documento1}/arquivo?modo=baixar`, { maxRedirects: 0 });
    expect([401, 403, 404]).toContain(r.status());
    const r2 = await p2.goto(`/e/${empresa2}/documentos/${documento1}`);
    expect(r2?.status()).toBe(404);
  }
  const exp = await p2.request.get(`/api/financeiro/exportar?empresa=${empresa1}&formato=csv`);
  expect(exp.status()).toBe(403);
  // Cliente sem permissão de conciliar vê a conciliação da própria empresa só para consulta
  await p2.goto(`/e/${empresa2}/conciliacao?aba=pendentes`);
  await expect(p2.getByRole("heading", { name: "Conciliação bancária" })).toBeVisible();
  await expect(p2.getByRole("button", { name: "Conciliar" })).toHaveCount(0);
  // O seletor de empresas não lista a empresa do outro cliente
  await p2.goto(`/e/${empresa2}`);
  await expect(p2.getByText("Padaria Pão Dourado")).toHaveCount(0);
  await ctx2.close();
});
