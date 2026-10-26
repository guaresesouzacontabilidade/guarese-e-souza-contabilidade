import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Estoque da loja (dados fictícios da demonstração, Madeireira Reflorestar):
 *  - o dono baixa o modelo, envia uma planilha em CSV, vê a prévia (novo e
 *    com erro) e importa; depois atualiza o preço e o estoque do mesmo código;
 *  - na nota de compra, liga a caixa de prego ao produto em quilo com o fator
 *    12 (quantidade e custo se ajustam) e cria um produto novo a partir do
 *    item; os vínculos ficam guardados;
 *  - com a entrada automática ligada, a próxima nota do mesmo fornecedor
 *    entra sozinha; apagar o vínculo faz a nota voltar a pedir conferência.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
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
const FORNECEDOR = `77${sufixo}000199`;
let empresaId = "";
let pregoId = "";

/** Nota de compra fictícia do fornecedor de teste (caixa de prego e, na primeira, um item novo). */
async function criarNota(numero: string, itens: { codigo: string; descricao: string; ncm: string; unidade: string; quantidade: number; valor_total: number }[]) {
  const { data: doc } = await servico!.from("documentos").select("id").eq("empresa_id", empresaId).limit(1).single();
  const { data: nota, error } = await servico!
    .from("documentos_fiscais")
    .insert({
      empresa_id: empresaId,
      documento_id: doc!.id,
      modelo: "55",
      tipo_documento: "NF-e",
      identificador: `E2E-ESTOQUE-${sufixo}-${numero}`,
      numero,
      competencia: new Date().toISOString().slice(0, 7) + "-01",
      data_emissao: new Date().toISOString(),
      operacao: "entrada",
      situacao_arquivo: "protocolo_autorizacao_no_arquivo",
      relacionado_empresa: true,
      emitente_documento: FORNECEDOR,
      emitente_nome: `FORNECEDOR TESTE ${sufixo} (FICTICIO)`,
      valor_total: itens.reduce((s, i) => s + i.valor_total, 0),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await servico!.from("documento_fiscal_itens").insert(
    itens.map((i, n) => ({
      documento_fiscal_id: nota!.id,
      empresa_id: empresaId,
      numero_item: n + 1,
      codigo: i.codigo,
      descricao: i.descricao,
      ncm: i.ncm,
      unidade: i.unidade,
      quantidade: i.quantidade,
      valor_unitario: i.valor_total / i.quantidade,
      valor_total: i.valor_total,
    })),
  );
  if (e2) throw new Error(e2.message);
  return nota!.id as string;
}

async function produto(filtro: { id?: string; codigo?: string; descricao?: string }) {
  let q = servico!.from("nfe_produtos").select("id, estoque_atual, preco_custo, valor_unitario, unidade").eq("empresa_id", empresaId);
  if (filtro.id) q = q.eq("id", filtro.id);
  if (filtro.codigo) q = q.eq("codigo", filtro.codigo);
  if (filtro.descricao) q = q.eq("descricao", filtro.descricao);
  const { data } = await q.maybeSingle();
  return data;
}

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = emp!.id;
  const { data: prego } = await servico!.from("nfe_produtos").select("id").eq("empresa_id", empresaId).like("descricao", "Prego 17 x 27%").single();
  pregoId = prego!.id;
});

test("planilha: modelo, prévia com erro, importação e atualização do mesmo código", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/produtos`);
  await page.getByRole("link", { name: "Importar planilha" }).click();
  await expect(page.getByRole("heading", { name: "Importar produtos e estoque" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar modelo (Excel)" }).click()]);
  expect(download.suggestedFilename()).toBe("modelo-produtos-estoque.xlsx");

  const codigo = `E2E-${sufixo}`;
  const csv = [
    "Código;Descrição;NCM;Unidade;Preço de venda;Preço de custo;Estoque",
    `${codigo};Tábua teste E2E ${sufixo};4407.11.00;un;12,50;8;30`,
    `E2E-ERRO-${sufixo};Sem NCM;;UN;5;;`,
  ].join("\n");
  await page.setInputFiles('input[name="arquivo"]', { name: "produtos.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByRole("button", { name: "Conferir a planilha" }).click();
  await expect(page.getByText("3. Confira e importe")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("produto novo precisa de NCM")).toBeVisible();
  await expect(page.getByText("A linha com erro fica de fora.")).toBeVisible();
  await page.getByRole("button", { name: "Importar 1 produto(s)" }).click();
  await expect(page.getByText(/Planilha importada: 1 produto\(s\) novo\(s\), 0 atualizado\(s\) e o estoque de 1 acertado/)).toBeVisible({ timeout: 30_000 });
  await page.waitForURL((u) => u.pathname.endsWith("/loja/produtos"));

  const novo = await produto({ codigo });
  expect([Number(novo!.estoque_atual), Number(novo!.preco_custo), Number(novo!.valor_unitario), novo!.unidade]).toEqual([30, 8, 12.5, "UN"]);
  const { data: mov } = await servico!.from("estoque_movimentos").select("tipo, observacao").eq("produto_id", novo!.id);
  expect(mov).toEqual([{ tipo: "inventario", observacao: "Importação da planilha de produtos" }]);
  expect(await produto({ codigo: `E2E-ERRO-${sufixo}` })).toBeNull();

  // Mesmo código: só o preço e o estoque mudam
  await page.goto(`/e/${empresaId}/loja/produtos/importar`);
  await page.setInputFiles('input[name="arquivo"]', {
    name: "precos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Código;Preço de venda;Estoque\n${codigo};13,90;25\n`, "utf8"),
  });
  await page.getByRole("button", { name: "Conferir a planilha" }).click();
  await expect(page.getByText("Atualizar", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Importar 1 produto(s)" }).click();
  await expect(page.getByText(/0 produto\(s\) novo\(s\), 1 atualizado\(s\)/)).toBeVisible({ timeout: 30_000 });
  const atualizado = await produto({ codigo });
  expect([Number(atualizado!.estoque_atual), Number(atualizado!.valor_unitario), Number(atualizado!.preco_custo)]).toEqual([25, 13.9, 8]);
});

test("nota de compra: fator da caixa, produto criado do item e entrada automática da próxima nota", async ({ page }) => {
  test.setTimeout(180_000);
  const antes = Number((await produto({ id: pregoId }))!.estoque_atual);
  const nota = await criarNota(`9${sufixo.slice(0, 3)}`, [
    { codigo: `CX-${sufixo}`, descricao: "PREGO 17X27 CX 12KG (TESTE)", ncm: "73170090", unidade: "CX", quantidade: 2, valor_total: 264 },
    { codigo: `NV-${sufixo}`, descricao: "DOBRADICA TESTE E2E", ncm: "83021000", unidade: "UN", quantidade: 5, valor_total: 50 },
  ]);

  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota?nota=${nota}`);
  await page.getByLabel("Produto do item 1").selectOption(pregoId);
  await page.getByLabel("Fator do item 1").fill("12");
  await expect(page.getByLabel("Quantidade do item 1")).toHaveValue("24");
  await expect(page.getByLabel("Custo do item 1")).toHaveValue("11");
  await expect(page.getByText(`(1 CX = 12 KG)`)).toBeVisible();

  await page.getByLabel("Produto do item 2").selectOption("novo");
  await page.locator("#novo-desc-2").fill(`Dobradiça teste E2E ${sufixo}`);
  await page.getByLabel("Preço de venda do item 2").fill("19,90");
  await expect(page.getByLabel("Custo do item 2")).toHaveValue("10");
  await page.getByRole("button", { name: "Dar entrada no estoque (2 itens)" }).click();
  await expect(page.getByText("Entrada registrada: 2 item(ns) da nota no estoque.")).toBeVisible({ timeout: 30_000 });

  expect(Number((await produto({ id: pregoId }))!.estoque_atual)).toBe(antes + 24);
  const dobradica = await produto({ descricao: `Dobradiça teste E2E ${sufixo}` });
  expect([Number(dobradica!.estoque_atual), Number(dobradica!.preco_custo), Number(dobradica!.valor_unitario), dobradica!.unidade]).toEqual([5, 10, 19.9, "UN"]);
  const { data: vinculos } = await servico!.from("estoque_vinculos").select("codigo_fornecedor, fator").eq("empresa_id", empresaId).eq("fornecedor_documento", FORNECEDOR).order("codigo_fornecedor");
  expect(vinculos!.map((v) => [v.codigo_fornecedor, Number(v.fator)])).toEqual([
    [`CX-${sufixo}`, 12],
    [`NV-${sufixo}`, 1],
  ]);

  // Entrada automática: desliga (se estiver ligada) e liga pela tela, conferindo o banco a cada clique
  const ligadaNoBanco = async () =>
    (await servico!.from("gestao_config").select("entrada_automatica").eq("empresa_id", empresaId).single()).data!.entrada_automatica;
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota`);
  if (await ligadaNoBanco()) {
    await page.getByRole("button", { name: "Desligar a entrada automática", exact: true }).click();
    await expect.poll(ligadaNoBanco, { timeout: 30_000 }).toBe(false);
    await expect(page.getByRole("button", { name: "Ligar a entrada automática", exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await page.getByRole("button", { name: "Ligar a entrada automática", exact: true }).click();
  await expect.poll(ligadaNoBanco, { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole("button", { name: "Desligar a entrada automática", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ligada", { exact: true })).toBeVisible();

  // A próxima nota do mesmo fornecedor entra sozinha (o processamento das notas chama esta função)
  const seguinte = await criarNota(`8${sufixo.slice(0, 3)}`, [
    { codigo: `CX-${sufixo}`, descricao: "PREGO 17X27 CX 12KG (TESTE)", ncm: "73170090", unidade: "CX", quantidade: 1, valor_total: 138 },
  ]);
  const { data: auto } = await servico!.rpc("estoque_entrada_automatica", { p_documento_fiscal_id: seguinte });
  expect(auto).toEqual({ situacao: "lancada", itens: 1 });
  const prego = await produto({ id: pregoId });
  expect([Number(prego!.estoque_atual), Number(prego!.preco_custo)]).toEqual([antes + 36, 11.5]);

  // Apagar o vínculo: a nota seguinte volta a pedir conferência
  await page.getByRole("link", { name: /Itens de fornecedor ligados/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row").filter({ hasText: `Cód. CX-${sufixo}` }).getByRole("button", { name: /Apagar o vínculo/ }).click();
  await expect(page.getByText("Vínculo apagado.", { exact: false })).toBeVisible({ timeout: 30_000 });
  const outra = await criarNota(`7${sufixo.slice(0, 3)}`, [
    { codigo: `CX-${sufixo}`, descricao: "PREGO 17X27 CX 12KG (TESTE)", ncm: "73170090", unidade: "CX", quantidade: 1, valor_total: 138 },
  ]);
  const { data: pendente } = await servico!.rpc("estoque_entrada_automatica", { p_documento_fiscal_id: outra });
  expect(pendente).toEqual({ situacao: "pendente", faltam: 1 });
});

test("balconista (só vende) não importa planilha, não baixa os produtos nem vê a entrada por nota", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `balcao@${DOMINIO}`);
  const r = await page.request.get(`/api/loja/produtos?empresa=${empresaId}&tipo=atuais`, { maxRedirects: 0 });
  expect(r.status()).toBe(403);
  await page.goto(`/e/${empresaId}/loja/produtos/importar`);
  await expect(page.getByRole("button", { name: "Conferir a planilha" })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota/vinculos`);
  await expect(page.getByRole("heading", { name: "Itens de fornecedor ligados" })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/loja/produtos`);
  await expect(page.getByRole("link", { name: "Importar planilha" })).toHaveCount(0);
});
