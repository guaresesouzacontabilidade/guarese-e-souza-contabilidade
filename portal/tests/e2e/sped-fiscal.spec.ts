import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * SPED Fiscal × XML (dados fictícios da demonstração): a equipe vê a
 * conferência da EFD da Oficina; envia um arquivo retificado do mesmo mês, que
 * passa a valer e é conferido sozinho; exclui esse arquivo e o anterior volta;
 * o cliente não acessa a conferência (uso interno da equipe).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";
// CNPJ fictício da Oficina de demonstração (scripts/seed-demo.ts)
const CNPJ_OFICINA = "44555666000181";

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

function mesPassado() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const ultimo = String(new Date(Date.UTC(ano, d.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0");
  return { ano, mes, ultimo };
}

test("equipe confere o SPED com os XML; arquivo retificado passa a valer; cliente não acessa", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const { ano, mes, ultimo } = mesPassado();
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio/auditor-fiscal");
  const quadro = page.locator("div.rounded-xl", { hasText: "SPED Fiscal × XML" }).first();
  await quadro.getByRole("link", { name: /Oficina Exemplo/ }).click();
  await page.waitForURL(/\/e\/[0-9a-f-]{36}\/auditor-fiscal\/sped/);
  const empresa = page.url().match(/\/e\/([0-9a-f-]{36})/)![1];

  // Conferência da EFD de demonstração
  await expect(page.getByRole("heading", { name: "Conferência do SPED Fiscal" })).toBeVisible();
  await expect(page.getByText("Nota emitida e não escriturada")).toBeVisible();
  await expect(page.getByText("ICMS diferente do destacado")).toBeVisible();
  await expect(page.getByText("Possível crédito de ICMS não aproveitado")).toBeVisible();
  await expect(page.getByText("Nota escriturada sem XML no portal")).toBeVisible();
  await expect(page.getByText("Apuração do ICMS (registro E110)")).toBeVisible();

  // Arquivo retificado do mesmo mês: uma única venda sem XML no portal
  const numero = String(Date.now()).slice(-6);
  const base = `17${String(ano).slice(2)}${mes}${CNPJ_OFICINA}55001${numero.padStart(9, "0")}1${numero.padStart(8, "0")}`;
  const chave = `${base}0`;
  const sped = [
    `|0000|020|1|01${mes}${ano}|${ultimo}${mes}${ano}|OFICINA MECANICA EXEMPLO LTDA (DEMONSTRACAO - FICTICIA)|${CNPJ_OFICINA}||TO|290000002|1718204|||A|1|`,
    "|0001|0|",
    "|0150|CLI09|CLIENTE TESTE AUTOMATICO (FICTICIO)|1058|98765432000198||||1718204||RUA A|1||CENTRO|",
    "|0990|4|",
    "|C001|0|",
    `|C100|1|0|CLI09|55|00|001|${numero}|${chave}|10${mes}${ano}|10${mes}${ano}|123,45|0|0,00|0,00|123,45|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
    "|C190|040|5102|0,00|123,45|0,00|0,00|0,00|0,00|0,00|0,00||",
    "|C990|4|",
    "|9999|9|",
  ].join("\r\n");
  const pasta = mkdtempSync(join(tmpdir(), "sped-"));
  const arquivo = join(pasta, `sped-retificado-e2e-${numero}.txt`);
  writeFileSync(arquivo, sped, "latin1");

  await page.getByRole("link", { name: /Enviar arquivo do SPED/ }).click();
  await expect(page.locator("#categoria")).toHaveValue("sped_fiscal");
  await page.setInputFiles('input[aria-label="Escolher arquivos"]', arquivo);
  await page.getByRole("button", { name: /Enviar \d+ arquivo/ }).click();
  await expect(page.getByText(/1 documento\(s\) recebido\(s\) pelo escritório/)).toBeVisible({ timeout: 60_000 });

  // A leitura roda logo depois do envio; o arquivo novo passa a valer
  await page.goto(`/e/${empresa}/auditor-fiscal/sped`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(`sped-retificado-e2e-${numero}.txt`).first()).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText("Conferido").first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 180_000 });
  await expect(page.getByText("arquivo substituto")).toBeVisible();
  await expect(page.getByText(`NF-e ${numero}/1`)).toBeVisible();
  await expect(page.locator("tr", { hasText: "substituído" })).toHaveCount(1);

  // Exclui o arquivo de teste: o anterior volta a valer
  await page.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("button", { name: "Tirar da conferência" }).click();
  await expect(page.getByText(/Arquivo tirado da conferência/)).toBeVisible({ timeout: 30_000 });
  await page.waitForURL(new RegExp(`/e/${empresa}/auditor-fiscal/sped$`));
  await expect(page.getByText(`sped-retificado-e2e-${numero}.txt`)).toHaveCount(0);
  await expect(page.getByText("Possível crédito de ICMS não aproveitado")).toBeVisible();

  // Cliente da Oficina: sem acesso à conferência
  const ctx = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const cliente = await ctx.newPage();
  await entrar(cliente, `cliente2@${DOMINIO}`);
  await cliente.goto(`/e/${empresa}/auditor-fiscal/sped`);
  await expect(cliente.getByText("A conferência do SPED é de uso da equipe do escritório.")).toBeVisible();
  await ctx.close();
});
