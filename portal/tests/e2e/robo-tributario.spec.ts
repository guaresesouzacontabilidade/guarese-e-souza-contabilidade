import { test, expect, type Page } from "@playwright/test";

/**
 * Robô de planejamento tributário (dados fictícios da demonstração):
 *  - a equipe roda o robô na clínica veterinária fictícia e vê o estudo do
 *    Fator R com a conta passo a passo;
 *  - aprova, baixa o PDF para o cliente, marca como apresentado, reabre,
 *    descarta (o motivo é obrigatório) e reabre de novo;
 *  - guarda as premissas do comparativo e o robô estuda de novo;
 *  - a lista da carteira mostra a oportunidade;
 *  - o cliente não abre as telas nem baixa o PDF.
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

/** Abre o estudo da clínica fictícia a partir da lista de empresas da carteira. */
async function abrirEstudoDaClinica(page: Page) {
  await page.goto("/escritorio/oportunidades?ver=todas");
  await expect(page.getByRole("heading", { name: "Oportunidades da carteira" })).toBeVisible();
  const link = page.locator("main").getByRole("link", { name: /Clínica Veterinária Amigo Fiel/ }).first();
  if (await link.count()) {
    await link.click();
  } else {
    // Ainda sem estudo: roda na carteira toda e espera a clínica aparecer
    await page.getByRole("button", { name: /Rodar agora em toda a carteira/ }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Rodar agora" }).click();
    await expect(async () => {
      await page.reload();
      await expect(page.locator("main").getByRole("link", { name: /Clínica Veterinária Amigo Fiel/ }).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 120_000 });
    await page.locator("main").getByRole("link", { name: /Clínica Veterinária Amigo Fiel/ }).first().click();
  }
  await expect(page.getByRole("heading", { name: /Estudo tributário — Clínica Veterinária Amigo Fiel/ })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("equipe: rodar o robô, revisar o estudo do Fator R e gerar o PDF", async ({ page }) => {
  test.setTimeout(300_000);
  await entrar(page, `contador@${DOMINIO}`);
  await abrirEstudoDaClinica(page);

  // Rodar agora nesta empresa
  await page.getByRole("button", { name: "Rodar agora" }).click();
  await expect(page.getByText(/O robô (começou a estudar|já está estudando) esta empresa/).first()).toBeVisible();
  const fator = page.locator("#fator_r");
  await expect(async () => {
    await page.reload();
    await expect(fator.getByText("Oportunidade", { exact: true })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  await expect(fator.getByRole("heading", { name: /Aumentar o pró-labore em R\$ .* por mês pode economizar R\$ .* por ano/ })).toBeVisible();
  await expect(fator.getByText("Pró-labore a mais para chegar a 28% (por ano)")).toBeVisible();
  await expect(fator.getByText("INSS do sócio sobre o pró-labore a mais (11%)")).toBeVisible();

  // Volta para "Para revisar" se uma execução anterior deixou outra situação
  const reabrir = fator.getByRole("button", { name: "Reabrir" });
  if (await reabrir.count()) {
    await reabrir.click();
    await expect(fator.getByText("Para revisar")).toBeVisible({ timeout: 30_000 });
  }

  // Aprovar (com observação)
  await fator.getByRole("button", { name: "Aprovar" }).click();
  const aprovar = page.getByRole("dialog");
  await aprovar.getByLabel("Observação (opcional)").fill("Conferido com a sócia (teste)");
  await aprovar.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByText("Estudo aprovado").first()).toBeVisible();
  await expect(fator.getByText("Aprovada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(fator.getByText(/Conferido com a sócia \(teste\)/)).toBeVisible();

  // PDF para o cliente (com as duas logos; só depois de aprovado)
  const [pdf] = await Promise.all([page.waitForEvent("download"), fator.getByRole("link", { name: "PDF para o cliente" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^estudo-tributario-fator-r-.*\.pdf$/);
  const caminho = await pdf.path();
  const fs = await import("node:fs");
  const bytes = fs.readFileSync(caminho);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");

  // Apresentado ao cliente
  await fator.getByRole("button", { name: "Marcar como apresentado" }).click();
  await expect(fator.getByText("Apresentada ao cliente", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Reabrir e descartar: o motivo é obrigatório
  await fator.getByRole("button", { name: "Reabrir" }).click();
  await expect(fator.getByText("Para revisar")).toBeVisible({ timeout: 30_000 });
  await fator.getByRole("button", { name: "Descartar" }).click();
  const descartar = page.getByRole("dialog");
  await descartar.getByRole("button", { name: "Descartar" }).click();
  await expect(descartar.getByText(/Explique em poucas palavras/)).toBeVisible();
  await descartar.getByLabel("Motivo").fill("A sócia não quer aumentar o pró-labore agora (teste)");
  await descartar.getByRole("button", { name: "Descartar" }).click();
  await expect(fator.getByText("Descartada", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(fator.getByText(/não quer aumentar o pró-labore agora/)).toBeVisible();
  // Com o estudo descartado, o PDF não sai
  const id = await page.evaluate(() => document.querySelector("#fator_r")?.getAttribute("data-estudo"));
  if (id) expect((await page.request.get(`/api/escritorio/oportunidades/${id}/pdf`)).status()).toBe(409);

  // Deixa como estava
  await fator.getByRole("button", { name: "Reabrir" }).click();
  await expect(fator.getByText("Para revisar")).toBeVisible({ timeout: 30_000 });
});

test("equipe: premissas guardadas e lista da carteira", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `contador@${DOMINIO}`);
  await abrirEstudoDaClinica(page);

  await page.getByLabel("Margem de lucro (%)").fill("15");
  await page.getByLabel("ICMS médio nas vendas (%)").fill("12");
  await page.getByRole("button", { name: "Guardar e estudar de novo" }).click();
  await expect(page.getByText("Premissas guardadas").first()).toBeVisible();
  await expect(page.getByLabel("Margem de lucro (%)")).toHaveValue("15");

  // O comparativo de regimes passa a usar as premissas guardadas
  await page.locator("#regime").getByRole("link", { name: "Abrir o comparativo de regimes" }).click();
  await expect(page.getByRole("heading", { name: "Comparativo de regimes" })).toBeVisible();
  await expect(page.getByLabel("Margem de lucro no Lucro Real (%)")).toHaveValue("15");
  await expect(page.getByText("Usando as premissas guardadas para o robô tributário.")).toBeVisible();

  // Lista da carteira: a oportunidade da clínica aparece em aberto, com a economia
  await page.goto("/escritorio/oportunidades");
  const linha = page.locator("main tbody tr").filter({ hasText: "Clínica Veterinária Amigo Fiel" }).filter({ hasText: "Fator R" });
  await expect(linha.first()).toBeVisible();
  await expect(linha.first().getByText(/R\$ [\d.]+,\d{2}/).first()).toBeVisible();
  await page.getByLabel("Estudo").selectOption("limite_simples");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/tipo=limite_simples/);
  await expect(page.locator("main tbody tr").filter({ hasText: "Fator R" })).toHaveCount(0);
});

test("cliente não abre o planejamento tributário nem baixa o PDF", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `veterinaria@${DOMINIO}`);
  for (const rota of ["/escritorio/oportunidades", "/escritorio/oportunidades/00000000-0000-4000-8000-000000000000"]) {
    await page.goto(rota);
    expect(new URL(page.url()).pathname).not.toBe(rota);
  }
  expect([401, 403]).toContain((await page.request.get("/api/escritorio/oportunidades/00000000-0000-4000-8000-000000000000/pdf")).status());
});
