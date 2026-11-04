import { test, expect, type Page } from "@playwright/test";

/**
 * Aparência "Grafite": as cores da logo oficial (grafite #39312b sobre
 * branco). É uma opção do menu Aparência (o padrão continua o Vidro líquido),
 * é clara (sem a paisagem nem os painéis de vidro) e fica guardada no aparelho.
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

test("grafite: cores da logo, tema claro, escolha guardada e o vidro continua o padrão", async ({ page }) => {
  test.setTimeout(120_000);
  // Quem nunca escolheu continua no vidro líquido
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/\bvidro\b/);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio");

  await page.getByRole("button", { name: /Aparência do portal/ }).click();
  await page.getByRole("menuitem", { name: "Grafite (cores da logo)" }).click();
  await expect(page.locator("html")).toHaveClass(/\bgrafite\b/);
  await expect(page.locator("html")).not.toHaveClass(/\bvidro\b|\bdark\b/);

  // Cores da logo: botão principal grafite com texto branco, fundo claro, sem a paisagem
  const cores = await page.evaluate(() => {
    const r = getComputedStyle(document.documentElement);
    return {
      primaria: r.getPropertyValue("--primary").trim(),
      textoPrimaria: r.getPropertyValue("--primary-foreground").trim(),
      fundo: r.getPropertyValue("--background").trim(),
      esquema: r.colorScheme,
      paisagem: getComputedStyle(document.body, "::before").backgroundImage,
    };
  });
  expect(cores).toMatchObject({ primaria: "#39312b", fundo: "#f6f5f3", esquema: "light", paisagem: "none" });
  expect(cores.textoPrimaria).toMatch(/^#fff(fff)?$/i); // o build encurta #ffffff para #fff
  // Cartões sólidos (brancos), não translúcidos
  const cartao = page.locator("main .bg-card").first();
  await expect(cartao).toBeVisible();
  expect(await cartao.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");

  // A escolha fica guardada ao recarregar e vale nas outras telas
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bgrafite\b/);
  await page.goto("/escritorio/mapa");
  await expect(page.locator("html")).toHaveClass(/\bgrafite\b/);
});
