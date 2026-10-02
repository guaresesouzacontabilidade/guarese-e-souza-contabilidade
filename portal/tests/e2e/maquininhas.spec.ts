import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * Maquininhas (dados fictícios da demonstração): o cliente envia o relatório
 * de vendas da Cielo num formato que o escritório já conhece e ele entra
 * sozinho; a conferência aponta a venda cobrada acima do contrato; a equipe
 * cadastra e exclui um contrato de frota; o colaborador sem permissão e o
 * cliente de outra empresa não veem nada.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";

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

/** Mês passado (o envio vai, por padrão, para a competência anterior). */
function mesPassado() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { ano: d.getUTCFullYear(), mes: String(d.getUTCMonth() + 1).padStart(2, "0") };
}

test("relatório no formato conhecido entra sozinho e aponta a taxa acima do contrato", async ({ browser }) => {
  test.setTimeout(420_000);
  const { ano, mes } = mesPassado();
  const nsu = String(Date.now()).slice(-9);
  const pasta = mkdtempSync(join(tmpdir(), "maquininha-"));
  const arquivo = join(pasta, `vendas-cielo-e2e-${nsu}.csv`);
  // Mesmo formato do relatório da Cielo da demonstração (o escritório já conferiu as colunas)
  writeFileSync(
    arquivo,
    [
      "Relatório de vendas - Cielo (teste automático - dados fictícios)",
      "Estabelecimento: 1020304050 - PADARIA PAO DOURADO (DEMO)",
      "",
      "Data da venda;Hora;Forma de pagamento;Bandeira;Parcelas;Valor bruto;Taxa;Valor líquido;NSU/DOC;Código de autorização;Número da máquina;Status;Data prevista de pagamento",
      // Débito Elo: contrato 1,19% → R$ 2,38; cobrado 1,99% → R$ 3,98 (R$ 1,60 a mais)
      `27/${mes}/${ano};09:10;Débito;Elo;1;200,00;3,98;196,02;${nsu};E2E01;PV-0001 (DEMO);Aprovada;28/${mes}/${ano}`,
      // Crédito à vista Visa: contrato da bandeira 2,79% → conforme
      `27/${mes}/${ano};09:20;Crédito à vista;Visa;1;100,00;2,79;97,21;${Number(nsu) + 1};E2E02;PV-0001 (DEMO);Aprovada;`,
    ].join("\r\n"),
  );

  const ctxCliente = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const cliente = await ctxCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = cliente.url().match(/\/e\/([0-9a-f-]{36})/)![1];

  // O menu da empresa leva às maquininhas; o botão "Enviar relatório" já escolhe o tipo do documento
  await cliente.getByRole("link", { name: "Maquininhas" }).first().click();
  await cliente.waitForURL(/\/maquininhas/);
  await cliente.getByRole("link", { name: /Enviar relatório/ }).click();
  await expect(cliente.locator("#categoria")).toHaveValue("relatorio_maquininha");
  await cliente.setInputFiles('input[aria-label="Escolher arquivos"]', arquivo);
  await cliente.getByRole("button", { name: /Enviar \d+ arquivo/ }).click();
  await expect(cliente.getByText(/1 documento\(s\) recebido\(s\) pelo escritório/)).toBeVisible({ timeout: 60_000 });

  // A leitura e a importação rodam logo depois do envio
  await cliente.goto(`/e/${empresa}/maquininhas?competencia=${ano}-${mes}`);
  const linha = cliente.locator("tr", { hasText: `vendas-cielo-e2e-${nsu}` });
  await expect(async () => {
    await cliente.reload();
    await expect(linha.getByText("Importado")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 180_000 });
  await expect(linha).toContainText(/R\$\s1,60 a mais/);
  // Aparece na lista das vendas cobradas acima do contrato
  await expect(cliente.getByText(`NSU ${nsu}`)).toBeVisible();
  await expect(cliente.getByText(`NSU ${Number(nsu) + 1}`)).toHaveCount(0);

  // Planilha da conferência do mês
  const planilha = await cliente.request.get(`/api/maquininhas/${empresa}?competencia=${ano}-${mes}`);
  expect(planilha.status()).toBe(200);
  expect(planilha.headers()["content-type"]).toContain("spreadsheetml");

  // O cliente titular tira o relatório de teste da conferência (o arquivo continua em Documentos)
  await linha.getByRole("link", { name: `vendas-cielo-e2e-${nsu}.csv` }).click();
  await cliente.getByRole("button", { name: "Excluir" }).click();
  await cliente.getByRole("button", { name: "Tirar da conferência" }).click();
  await expect(cliente.getByText(/Relatório e vendas excluídos da conferência/)).toBeVisible({ timeout: 30_000 });
  await cliente.waitForURL(new RegExp(`/e/${empresa}/maquininhas$`));
  await expect(cliente.locator("tr", { hasText: `vendas-cielo-e2e-${nsu}` })).toHaveCount(0);
  await ctxCliente.close();

  // Colaborador sem a permissão: sem menu, sem página e sem planilha
  const ctxColab = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const colab = await ctxColab.newPage();
  await entrar(colab, `colaborador@${DOMINIO}`);
  await colab.goto(`/e/${empresa}`);
  await expect(colab.getByRole("link", { name: "Maquininhas" })).toHaveCount(0);
  await colab.goto(`/e/${empresa}/maquininhas`);
  await expect(colab.getByText("Seu acesso não inclui a conferência das maquininhas desta empresa.")).toBeVisible();
  expect((await colab.request.get(`/api/maquininhas/${empresa}?competencia=${ano}-${mes}`)).status()).toBe(403);
  await ctxColab.close();

  // Cliente de outra empresa
  const ctxOutro = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const outro = await ctxOutro.newPage();
  await entrar(outro, `cliente2@${DOMINIO}`);
  expect((await outro.request.get(`/api/maquininhas/${empresa}?competencia=${ano}-${mes}`)).status()).toBe(403);
  await ctxOutro.close();
});

test("equipe cadastra um contrato de frota com a taxa e depois exclui", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio/maquininhas");
  await expect(page.getByRole("heading", { name: "Maquininhas" })).toBeVisible();
  await page.getByRole("link", { name: /Padaria Pão Dourado/ }).first().click();
  await page.waitForURL(/\/e\/[0-9a-f-]{36}\/maquininhas/);
  await page.getByRole("link", { name: /Contratos e taxas/ }).click();
  await page.waitForURL(/\/maquininhas\/contratos/);

  const nome = `Frota Teste ${Date.now().toString().slice(-6)}`;
  await page.getByRole("button", { name: "Novo contrato" }).first().click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#ct-adq").selectOption("outra");
  await dialogo.locator("#ct-nome").fill(nome);
  await dialogo.locator("#ct-tipo").selectOption("frota");
  await dialogo.locator("#ct-ini").fill("2026-01-01");
  await dialogo.locator("#ct-rapida_frota").fill("2,5");
  await dialogo.getByRole("button", { name: "Cadastrar contrato" }).click();
  await expect(page.getByText(/Contrato cadastrado/)).toBeVisible({ timeout: 30_000 });

  const cartao = page.locator("div.rounded-xl", { hasText: nome }).first();
  await expect(cartao).toContainText("Frota e combustível");
  await expect(cartao).toContainText("Frota / combustível");
  await expect(cartao).toContainText("2,5%");

  await cartao.getByRole("button", { name: `Ações do contrato ${nome}` }).click();
  await page.getByRole("menuitem", { name: /Excluir contrato/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Contrato excluído.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(nome)).toHaveCount(0);
});
