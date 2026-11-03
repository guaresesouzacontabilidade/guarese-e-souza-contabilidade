import { test, expect, type Page } from "@playwright/test";

/**
 * Aparência "Vidro líquido": escolhida no menu de aparência, vale para o
 * portal inteiro (fica guardada no aparelho), põe a paisagem no fundo e deixa
 * os painéis translúcidos; a paisagem abre sem login (usada também na tela de
 * entrada).
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

test("vidro líquido: escolher no menu, fundo de paisagem, painéis translúcidos e escolha guardada", async ({ page, request }) => {
  test.setTimeout(120_000);
  // A paisagem é um arquivo público (também aparece antes do login)
  const fundo = await request.get("/marca/fundo-vidro.svg");
  expect(fundo.status()).toBe(200);
  expect(fundo.headers()["content-type"]).toContain("image/svg+xml");

  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio");
  await page.getByRole("button", { name: /Aparência do portal/ }).click();
  await page.getByRole("menuitem", { name: "Vidro líquido" }).click();
  await expect(page.locator("html")).toHaveClass(/\bvidro\b/);

  // Fundo com a paisagem e painéis de vidro (translúcidos e desfocando o fundo)
  const fundoBody = await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage);
  expect(fundoBody).toContain("fundo-vidro.svg");
  const cartao = page.locator("main .bg-card").first();
  await expect(cartao).toBeVisible();
  const estilo = await cartao.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fundo: s.backgroundColor, desfoque: s.backdropFilter || (s as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || "" };
  });
  expect(estilo.fundo).toMatch(/rgba\(.*0\.6\)/);
  expect(estilo.desfoque).toContain("blur");
  // Topo em cápsula
  const raio = await page.locator("header.casca-topo").evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(raio).toBeGreaterThan(10);

  // A escolha fica guardada ao recarregar e vale nas outras telas
  await page.goto("/escritorio/mapa");
  await expect(page.locator("html")).toHaveClass(/\bvidro\b/);

  // Volta para a aparência clara
  await page.getByRole("button", { name: /Aparência do portal/ }).click();
  await page.getByRole("menuitem", { name: "Clara (Luz)" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bvidro\b/);
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage)).toBe("none");
});
