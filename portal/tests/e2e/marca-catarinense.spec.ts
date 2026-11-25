import { test, expect, type Page } from "@playwright/test";

/**
 * Marca do sistema: Catarinense Tech, com o símbolo da Catarinense, o bordão
 * "Sua empresa conectada ao futuro." e o tema verde e vermelho como padrão.
 * Ícones de instalação e da aba abrem sem login; o nome antigo do sistema não aparece.
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

test("ícones e instalação com o nome Catarinense Tech, sem login", async ({ request }) => {
  const manifesto = await request.get("/manifest.webmanifest");
  expect(manifesto.status()).toBe(200);
  const m = await manifesto.json();
  expect(m).toMatchObject({ name: "Catarinense Tech", short_name: "Catarinense Tech", description: "Sua empresa conectada ao futuro." });
  for (const icone of m.icons as { src: string }[]) {
    const r = await request.get(icone.src);
    expect(r.status(), icone.src).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  for (const caminho of ["/icon.png", "/apple-icon.png", "/marca/simbolo.png", "/marca/selo-96.png"]) {
    const r = await request.get(caminho);
    expect(r.status(), caminho).toBe(200);
  }
});

test("tela de entrada e portal com a marca, o bordão e o tema verde e vermelho", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await expect(page).toHaveTitle(/Catarinense Tech/);
  await expect(page.locator("html")).toHaveClass(/\bcatarinense\b/);
  await expect(page.getByRole("img", { name: "Catarinense Tech" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sua empresa conectada ao futuro." })).toBeVisible();
  // O nome antigo do sistema não aparece (os dados do escritório no rodapé vêm de Configurações)
  await expect(page.locator("body")).not.toContainText("Portal Guarese");

  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio");
  // Logo no menu e o rodapé do menu com o nome e o bordão
  await expect(page.getByRole("link", { name: "Início" }).getByRole("img", { name: "Catarinense Tech" })).toBeVisible();
  await expect(page.getByText("Sua empresa conectada ao futuro.").first()).toBeVisible();
  const cores = await page.evaluate(() => {
    const r = getComputedStyle(document.documentElement);
    return { primaria: r.getPropertyValue("--primary").trim(), nome: r.getPropertyValue("--marca-nome").trim(), esquema: r.colorScheme };
  });
  expect(cores).toMatchObject({ primaria: "#07461f", nome: "#07461f", esquema: "light" });
  // A letra do nome na logo carregou (Cinzel)
  expect(await page.evaluate(() => document.fonts.check('700 16px "Cinzel"'))).toBe(true);

  // A Catarinense também está no menu Aparência
  await page.getByRole("button", { name: /Aparência do portal/ }).click();
  await expect(page.getByRole("menuitem", { name: "Catarinense (verde e vermelho)" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("termos e privacidade com o nome do sistema e os dados do escritório da configuração", async ({ page }) => {
  await page.goto("/privacidade");
  await expect(page.getByText(/trata dados pessoais no Catarinense Tech/)).toBeVisible();
  await page.goto("/termos");
  await expect(page.getByText("Ao utilizar o Catarinense Tech, você concorda com as condições abaixo.")).toBeVisible();
});
