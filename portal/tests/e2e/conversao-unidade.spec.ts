import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Conversão de unidade no cadastro do produto (dados fictícios da Madeireira):
 *  - o dono cadastra a vigota comprada em peça e vendida em metro; o portal
 *    sugere o rendimento pelo comprimento da peça e mostra o resumo;
 *  - "rende 1" com unidades diferentes mostra o aviso para conferir;
 *  - no ajuste do estoque, 10 peças viram 30 metros;
 *  - na nota de compra em peças, o rendimento vem do cadastro: 5 peças = 15 m,
 *    com o custo por metro.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";

function clienteServico(): SupabaseClient | null {
  if (existsSync(".env.local")) {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const chave = process.env.SUPABASE_SECRET_KEY ?? "";
  return url && chave ? createClient(url, chave, { auth: { persistSession: false } }) : null;
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta)/.test(u.pathname), { timeout: 90_000 });
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

const sufixo = String(randomInt(100000, 999999));
const NOME = `Vigota 8x8 E2E ${sufixo} (DEMO)`;
const GTIN = `789${sufixo}0000`.slice(0, 12);
let empresaId = "";
let produtoId = "";

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = emp!.id;
});

test("o dono cadastra a vigota: compra em peça, vende em metro (1 peça = 3 m)", async ({ page }) => {
  await entrar(page, "madeireira@demo.guareses.test");
  await page.goto(`/e/${empresaId}/loja/produtos`);
  await page.getByRole("button", { name: "Novo produto" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Descrição do produto").fill(NOME);
  await dialogo.getByLabel("NCM").fill("44071100");
  await dialogo.getByLabel("Unidade de venda").selectOption("M");
  await dialogo.getByLabel("Comprimento padrão (m)").fill("3");
  await dialogo.getByLabel(/Preço de venda/).fill("18,00");
  await dialogo.getByLabel("Código de barras (GTIN)").fill(GTIN);

  await dialogo.getByLabel("Compro em uma unidade e vendo em outra").check();
  await dialogo.getByLabel("Unidade de compra").selectOption("PC");
  // Rende 1 com unidades diferentes: aviso para conferir
  await dialogo.getByLabel(/Cada peça rende/).fill("1");
  await expect(dialogo.getByText("Confira: 1 peça rende só 1 metro?")).toBeVisible();
  // O portal sugere pelo comprimento da peça
  await expect(dialogo.getByText(/Pelas medidas da peça: 3 m/)).toBeVisible();
  await dialogo.getByRole("button", { name: "usar" }).click();
  await expect(dialogo.getByLabel(/Cada peça rende/)).toHaveValue("3");
  await expect(dialogo.getByTestId("resumo-conversao")).toContainText("1 Peça equivale a 3 Metros");
  await expect(dialogo.getByTestId("resumo-conversao")).toContainText("Ex.: 10 Peças = 30 Metros");
  await expect(dialogo.getByText("Confira: 1 peça rende só 1 metro?")).toHaveCount(0);

  await dialogo.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Produto cadastrado.")).toBeVisible({ timeout: 30_000 });
  const { data: p } = await servico!.from("nfe_produtos").select("id, unidade, unidade_compra, fator_compra").eq("empresa_id", empresaId).eq("descricao", NOME).single();
  produtoId = p!.id;
  expect([p!.unidade, p!.unidade_compra, Number(p!.fator_compra)]).toEqual(["M", "PC", 3]);

  // A ficha do produto mostra a conversão; o ajuste do estoque aceita peças
  await page.goto(`/e/${empresaId}/loja/produtos/${produtoId}`);
  await expect(page.getByText(/compra em peça: 1 PC = 3 m/)).toBeVisible();
  await page.getByRole("button", { name: "Ajustar estoque" }).click();
  const ajuste = page.getByRole("dialog");
  await ajuste.getByLabel("Tipo").selectOption("entrada_manual");
  // Madeira vendida em metro já tem o campo de peças (comprimento da peça = rendimento)
  await ajuste.getByLabel("Peças", { exact: true }).fill("10");
  await ajuste.getByRole("button", { name: "= 30 m (usar)" }).click();
  await expect(ajuste.locator("#qtd-mov")).toHaveValue("30");
  await ajuste.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Entrada registrada no estoque.")).toBeVisible({ timeout: 30_000 });
  const { data: depois } = await servico!.from("nfe_produtos").select("estoque_atual").eq("id", produtoId).single();
  expect(Number(depois!.estoque_atual)).toBe(30);
});

test("nota de compra em peças: o rendimento vem do cadastro (5 peças = 15 m)", async ({ page }) => {
  const { data: doc } = await servico!.from("documentos").select("id").eq("empresa_id", empresaId).limit(1).single();
  const { data: nota, error } = await servico!
    .from("documentos_fiscais")
    .insert({
      empresa_id: empresaId,
      documento_id: doc!.id,
      modelo: "55",
      tipo_documento: "NF-e",
      identificador: `E2E-CONVERSAO-${sufixo}`,
      numero: sufixo,
      competencia: new Date().toISOString().slice(0, 7) + "-01",
      data_emissao: new Date().toISOString(),
      operacao: "entrada",
      situacao_arquivo: "protocolo_autorizacao_no_arquivo",
      relacionado_empresa: true,
      emitente_documento: `66${sufixo}000188`,
      emitente_nome: `SERRARIA TESTE ${sufixo} (FICTICIA)`,
      valor_total: 150,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await servico!.from("documento_fiscal_itens").insert({
    documento_fiscal_id: nota!.id, empresa_id: empresaId, numero_item: 1, codigo: `V${sufixo}`, descricao: "VIGOTA 8X8 TACHI PRETO",
    ncm: "44071100", gtin: GTIN, unidade: "PÇ", quantidade: 5, valor_unitario: 30, valor_total: 150,
  });
  if (e2) throw new Error(e2.message);

  await entrar(page, "madeireira@demo.guareses.test");
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota?nota=${nota!.id}`);
  await expect(page.getByLabel("Produto do item 1")).toHaveValue(produtoId, { timeout: 60_000 });
  await expect(page.getByLabel("Fator do item 1")).toHaveValue("3");
  await expect(page.getByTestId("conversao-item-1")).toContainText("Cadastro: 1 peça = 3 m");
  await expect(page.getByLabel("Quantidade do item 1")).toHaveValue("15");
  await expect(page.getByLabel("Custo do item 1")).toHaveValue("10");
  await page.getByRole("button", { name: /Dar entrada no estoque/ }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/loja/produtos"), { timeout: 60_000 });
  const { data: depois } = await servico!.from("nfe_produtos").select("estoque_atual").eq("id", produtoId).single();
  expect(Number(depois!.estoque_atual)).toBe(45);
});

test("compra em caixa e vende por unidade: o ajuste aceita caixas (2 caixas = 200 un)", async ({ page }) => {
  await entrar(page, "madeireira@demo.guareses.test");
  await page.goto(`/e/${empresaId}/loja/produtos`);
  await page.getByRole("button", { name: "Novo produto" }).click();
  const dialogo = page.getByRole("dialog");
  const nome = `Parafuso E2E ${sufixo} (DEMO)`;
  await dialogo.getByLabel("Descrição do produto").fill(nome);
  await dialogo.getByLabel("NCM").fill("73181500");
  await dialogo.getByLabel("Unidade de venda").selectOption("UN");
  await dialogo.getByLabel(/Preço de venda/).fill("0,50");
  await dialogo.getByLabel("Compro em uma unidade e vendo em outra").check();
  await dialogo.getByLabel("Unidade de compra").selectOption("CX");
  await dialogo.getByLabel(/Cada caixa rende/).fill("100");
  await expect(dialogo.getByTestId("resumo-conversao")).toContainText("1 Caixa equivale a 100 Unidades");
  await dialogo.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Produto cadastrado.")).toBeVisible({ timeout: 30_000 });
  const { data: p } = await servico!.from("nfe_produtos").select("id").eq("empresa_id", empresaId).eq("descricao", nome).single();

  await page.goto(`/e/${empresaId}/loja/produtos/${p!.id}`);
  await page.getByRole("button", { name: "Ajustar estoque" }).click();
  const ajuste = page.getByRole("dialog");
  await ajuste.getByLabel("Tipo").selectOption("entrada_manual");
  await ajuste.getByLabel(/Em caixas/).fill("2");
  await ajuste.getByRole("button", { name: "= 200 UN (usar)" }).click();
  await expect(ajuste.locator("#qtd-mov")).toHaveValue("200");
  await ajuste.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Entrada registrada no estoque.")).toBeVisible({ timeout: 30_000 });
  const { data: depois } = await servico!.from("nfe_produtos").select("estoque_atual").eq("id", p!.id).single();
  expect(Number(depois!.estoque_atual)).toBe(200);
});
