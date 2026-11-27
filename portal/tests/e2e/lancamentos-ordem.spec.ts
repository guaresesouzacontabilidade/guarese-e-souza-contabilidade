import { test, expect, type Page } from "@playwright/test";

/**
 * Contas a pagar (dados fictícios da Padaria): sem escolher a ordem, a lista
 * começa pelo vencimento mais antigo (hoje antes de 2027); "Data mais nova
 * primeiro" inverte. A planilha sai na mesma ordem da tela.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";

async function entrar(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "cliente@demo.guareses.test");
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname.startsWith("/aceite") || /^\/e\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

/** Vencimentos da tela, na ordem em que aparecem (AAAA-MM-DD). */
async function vencimentos(page: Page) {
  const textos = await page.locator("tbody tr").evaluateAll((linhas) =>
    linhas.map((l) => /(\d{2})\/(\d{2})\/(\d{4})/.exec(l.textContent ?? "")).filter(Boolean).map((m) => `${m![3]}-${m![2]}-${m![1]}`),
  );
  expect(textos.length).toBeGreaterThan(2);
  return textos;
}

test("contas a pagar começam pelo vencimento mais antigo; dá para inverter", async ({ page }) => {
  await entrar(page);
  const empresa = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/e/${empresa}/financeiro/lancamentos?tipo=pagar&inicio=2020-01-01`);
  const crescente = await vencimentos(page);
  expect(crescente).toEqual([...crescente].sort());
  await expect(page.getByLabel("Ordem")).toHaveValue("crescente");

  await page.getByLabel("Ordem").selectOption("decrescente");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await page.waitForURL((u) => u.searchParams.get("ordem") === "decrescente", { timeout: 60_000 });
  const decrescente = await vencimentos(page);
  expect(decrescente).toEqual([...decrescente].sort().reverse());
  expect(decrescente[0] >= crescente[0]).toBe(true);

  // A planilha (CSV) sai na mesma ordem escolhida
  const resposta = await page.request.get(`/api/financeiro/exportar?empresa=${empresa}&formato=csv&tipo=pagar&inicio=2020-01-01&ordem=crescente`);
  expect(resposta.ok()).toBe(true);
  const datas = [...(await resposta.text()).matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  expect(datas.length).toBeGreaterThan(2);
});
