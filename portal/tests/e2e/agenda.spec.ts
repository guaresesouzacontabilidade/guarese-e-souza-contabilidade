import { test, expect, type Page } from "@playwright/test";

/**
 * Agenda de pagamentos: o cliente vê as guias do mês, informa "Paguei" com o
 * comprovante e o escritório vê o pagamento na guia. Usa os dados fictícios
 * de `npm run seed:demo` (o teste desfaz o pagamento no fim).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

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

test("cliente informa o pagamento de uma guia com comprovante", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/[0-9a-f-]{36}/)![0];

  await page.goto(`${empresa}/agenda`);
  await expect(page.getByRole("heading", { name: "Agenda de pagamentos" })).toBeVisible();
  const linha = page.locator("li.py-3", { hasText: /FGTS — / }).filter({ has: page.getByRole("button", { name: "Paguei" }) }).first();
  await expect(linha).toBeVisible();
  await linha.getByRole("button", { name: "Paguei" }).click();

  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#pg-arquivo").setInputFiles({
    name: `comprovante-fgts-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\n% comprovante de teste ${Date.now()}\n%%EOF\n`),
  });
  await dialogo.getByRole("button", { name: "Confirmar pagamento" }).click();
  await expect(page.getByText(/Pagamento informado/).first()).toBeVisible({ timeout: 60_000 });
  const paga = page.locator("li.py-3", { hasText: /FGTS — / }).filter({ hasText: /Pago em/ }).first();
  await expect(paga).toContainText("comprovante enviado");

  // Desfaz para manter a demonstração como estava
  await paga.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Pagamento desfeito.")).toBeVisible({ timeout: 30_000 });
});
