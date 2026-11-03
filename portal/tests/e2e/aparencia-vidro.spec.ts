import { test, expect, type Page } from "@playwright/test";

/**
 * Aparência "Vidro líquido": é a padrão (quem nunca escolheu entra nela, já
 * na tela de entrada), vale para o portal inteiro, põe a paisagem no fundo e
 * deixa os painéis translúcidos; outra aparência escolhida no menu fica
 * guardada no aparelho; a paisagem abre sem login.
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

test("vidro líquido: padrão, fundo de paisagem, painéis translúcidos e escolha guardada", async ({ page, request }) => {
  test.setTimeout(120_000);
  // A paisagem é um arquivo público (também aparece antes do login)
  const fundo = await request.get("/marca/fundo-vidro.svg");
  expect(fundo.status()).toBe(200);
  expect(fundo.headers()["content-type"]).toContain("image/svg+xml");

  // Padrão: quem nunca escolheu uma aparência já entra no vidro líquido (inclusive na tela de entrada)
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/\bvidro\b/);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio");
  await expect(page.locator("html")).toHaveClass(/\bvidro\b/);
  // Escolher outra e voltar pelo menu
  await page.getByRole("button", { name: /Aparência do portal/ }).click();
  await page.getByRole("menuitem", { name: "Bronze" }).click();
  await expect(page.locator("html")).toHaveClass(/\bbronze\b/);
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

  // Quem escolhe a aparência clara fica com ela, sem a paisagem
  await page.getByRole("button", { name: /Aparência do portal/ }).click();
  await page.getByRole("menuitem", { name: "Clara (Luz)" }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bvidro\b/);
  expect(await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage)).toBe("none");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
});
