import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

/**
 * XML em lote: a equipe pede o ZIP de 09/2026 da Padaria de demonstração e
 * baixa o arquivo (pastas por tipo, planilha da relação e LEIA-ME); o cliente
 * de outra empresa não consegue baixar esse lote; a equipe pede o lote da
 * carteira e recebe um arquivo por empresa com notas no mês.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

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

test("equipe gera e baixa o XML do mês; outro cliente não baixa; lote da carteira", async ({ browser }) => {
  test.setTimeout(420_000);
  const ctxEquipe = await browser.newContext({ locale: "pt-BR", acceptDownloads: true });
  const equipe = await ctxEquipe.newPage();
  await entrar(equipe, `contador@${DOMINIO}`);
  await equipe.goto("/escritorio/notas-automaticas");
  await equipe.getByRole("link", { name: /Padaria Pão Dourado/ }).first().click();
  await equipe.waitForURL(/\/e\/[0-9a-f-]{36}\/notas-automaticas/);

  // Pedido do lote da empresa
  const cartao = equipe.locator("#lotes-xml");
  await expect(cartao.getByText("XML do mês em lote")).toBeVisible();
  await cartao.locator("#lote-competencia").selectOption("2026-09");
  await cartao.getByRole("button", { name: "Gerar arquivo do mês" }).click();
  await expect(equipe.getByText(/Gerando os XML de 09\/2026/)).toBeVisible({ timeout: 30_000 });
  const linha = cartao.locator("tr", { hasText: "09/2026" }).first();
  const baixar = linha.getByRole("link", { name: /Baixar/ });
  await expect(baixar).toBeVisible({ timeout: 180_000 });
  const href = (await baixar.getAttribute("href"))!;
  expect(href).toMatch(/^\/api\/lotes-xml\/[0-9a-f-]{36}\/1$/);

  const [download] = await Promise.all([equipe.waitForEvent("download"), baixar.click()]);
  expect(download.suggestedFilename()).toMatch(/^xml-2026-09-padaria-pao-dourado-demo\.zip$/);
  const zip = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
  const nomes = Object.keys(zip);
  expect(nomes).toContain("LEIA-ME.txt");
  expect(nomes).toContain("Relacao das notas.xlsx");
  expect(nomes.some((n) => /^NFC-e\/\d{44}\.xml$/.test(n))).toBe(true);
  expect(nomes.some((n) => /^NF-e de entrada\/\d{44}\.xml$/.test(n))).toBe(true);
  const leiaMe = strFromU8(zip["LEIA-ME.txt"]);
  expect(leiaMe).toContain("Mês de emissão: 09/2026");
  expect(leiaMe).toMatch(/Total: \d+ arquivos/);
  const xml = strFromU8(zip[nomes.find((n) => n.startsWith("NFC-e/"))!]);
  expect(xml).toContain("<infNFe");

  // Cliente de outra empresa: sem acesso ao lote
  const ctxOutro = await browser.newContext({ locale: "pt-BR" });
  const outro = await ctxOutro.newPage();
  await entrar(outro, `cliente2@${DOMINIO}`);
  const negado = await outro.request.get(href, { maxRedirects: 0 });
  expect(negado.status()).toBe(403);
  await ctxOutro.close();

  // Lote da carteira: um arquivo por empresa com notas em 09/2026
  await equipe.goto("/escritorio/notas-automaticas");
  const carteira = equipe.locator("#lotes-xml");
  await carteira.locator("#lote-competencia").selectOption("2026-09");
  await carteira.getByRole("button", { name: "Gerar para a carteira" }).click();
  await expect(equipe.getByText(/Gerando os XML de 09\/2026 de 2 empresas/)).toBeVisible({ timeout: 30_000 });
  const pedido = carteira.locator("div.rounded-md", { hasText: "pedido em" }).first();
  await expect(pedido.getByText("2 de 2 empresas prontas")).toBeVisible({ timeout: 240_000 });
  await expect(pedido.getByRole("link", { name: /Baixar/ })).toHaveCount(2);
  await ctxEquipe.close();
});
