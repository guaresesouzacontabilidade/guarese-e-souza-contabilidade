import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";

/**
 * Pente fino de segurança (navegador):
 *  - o "voltar para onde estava" do login não leva para outro site, nem com
 *    caractere invisível no endereço;
 *  - senha errada muitas vezes seguidas para o mesmo e-mail faz esperar 15 minutos.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

test("o login não redireciona para outro site, nem com caractere invisível", async ({ page }) => {
  await page.goto(`/login?proximo=${encodeURIComponent("/\t/site-falso.example")}`);
  await page.fill('input[name="email"]', "cliente@demo.guareses.test");
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname.startsWith("/aceite") || u.pathname.startsWith("/e/") || u.pathname.startsWith("/painel"), { timeout: 90_000 });
  expect(new URL(page.url()).origin).toBe(new URL(BASE).origin);
  expect(page.url()).not.toContain("site-falso");
});

test("senha errada 10 vezes para o mesmo e-mail faz esperar 15 minutos", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `tentativas-${randomInt(100000, 999999)}@demo.guareses.test`;
  await page.goto("/login");
  // Envia e espera a resposta do servidor (o formulário se limpa depois de cada tentativa)
  const tentar = async (senha: string) => {
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="senha"]', senha);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"),
      page.click('button[type="submit"]'),
    ]);
    await expect(page.locator('input[name="senha"]')).toHaveValue("", { timeout: 30_000 });
  };
  for (let i = 0; i < 10; i++) {
    await tentar(`Errada-${i}-Xy9`);
    await expect(page.getByText(/E-mail ou senha incorretos|Muitas tentativas/)).toBeVisible({ timeout: 30_000 });
    if (await page.getByText(/Muitas tentativas\. Aguarde alguns minutos/).isVisible()) test.skip(true, "limite do provedor de login atingido antes do limite do portal");
  }
  await tentar("Mais-Uma-Tentativa-1");
  await expect(page.getByText("Muitas tentativas de entrada. Aguarde 15 minutos")).toBeVisible({ timeout: 30_000 });
});
