import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Preços de venda, margem e reposição do estoque (dados fictícios da
 * demonstração, Madeireira Reflorestar):
 *  - o dono cadastra um produto com a margem que quer ganhar e usa o preço
 *    sugerido; na aba Preços de venda vê o custo mudar depois de uma compra
 *    mais cara, filtra "Custo mudou e o preço não", usa o sugerido e salva —
 *    o histórico guarda quem mudou e o preço antigo e o novo;
 *  - na Reposição e análise vê a sugestão de compra e baixa os relatórios;
 *  - o balconista (só vende) não vê custos, margens nem a análise.
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
const NOME = `Tábua teste preço ${sufixo} (E2E)`;
let empresaId = "";
let produtoId = "";
let margemAntes: number | null = null;

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = emp!.id;
  const { data: cfg } = await servico!.from("gestao_config").select("margem_entrada").eq("empresa_id", empresaId).maybeSingle();
  margemAntes = cfg?.margem_entrada ?? null;
});

test.afterAll(async () => {
  // Devolve a margem padrão como estava na demonstração
  await servico!.from("gestao_config").update({ margem_entrada: margemAntes }).eq("empresa_id", empresaId);
  if (produtoId) {
    await servico!.from("estoque_movimentos").delete().eq("produto_id", produtoId);
    await servico!.from("nfe_produtos").delete().eq("id", produtoId);
  }
});

test("dono: margem no cadastro, preço sugerido, tabela de preços com histórico e reposição", async ({ page }) => {
  test.setTimeout(300_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  const base = `/e/${empresaId}/loja/produtos`;

  // Cadastro com a margem que quer ganhar: custo 30 + 35% = 40,50
  await page.goto(base);
  await page.getByRole("button", { name: "Novo produto" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Descrição do produto").fill(NOME);
  await dialogo.getByLabel("Grupo").fill("Pinus");
  await dialogo.getByLabel("NCM").fill("44071100");
  await dialogo.getByLabel(/Custo de compra/).fill("30,00");
  await dialogo.getByLabel("Margem que quero ganhar (%)").fill("35");
  await dialogo.getByLabel(/Preço de venda/).fill("38,00");
  await expect(dialogo.getByText("Sugerido: R$ 40,50")).toBeVisible();
  await dialogo.getByRole("button", { name: "usar" }).click();
  await expect(dialogo.getByLabel(/Preço de venda/)).toHaveValue("40,50");
  await dialogo.getByLabel("Estoque mínimo").fill("10");
  await dialogo.getByRole("button", { name: "Cadastrar produto" }).click();
  await expect(page.getByText("Produto cadastrado.")).toBeVisible({ timeout: 30_000 });
  const { data: p } = await servico!.from("nfe_produtos").select("id, valor_unitario, margem_desejada").eq("empresa_id", empresaId).eq("descricao", NOME).single();
  produtoId = p!.id;
  expect(Number(p!.valor_unitario)).toBe(40.5);
  expect(Number(p!.margem_desejada)).toBe(35);

  // Compra mais cara (entrada manual com custo 36): o custo mudou e o preço não
  await page.getByRole("button", { name: "Ajustar estoque" }).click();
  const ajuste = page.getByRole("dialog");
  await ajuste.getByLabel("Tipo").selectOption("entrada_manual");
  await ajuste.getByLabel("Produto").selectOption(produtoId);
  await ajuste.getByLabel(/^Quantidade/).fill("12");
  await ajuste.getByLabel(/Custo unitário/).fill("36,00");
  await ajuste.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Entrada registrada no estoque.")).toBeVisible({ timeout: 30_000 });
  // O portal oferece conferir os preços
  await page.getByRole("button", { name: "Conferir preços" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/produtos/precos"), { timeout: 60_000 });

  // Filtro "Da última entrada" já aberto, com o produto e o aviso de custo
  await expect(page.getByRole("button", { name: /Da última entrada/ })).toHaveAttribute("aria-pressed", "true");
  const linha = page.getByRole("row", { name: new RegExp(NOME.replace(/[()]/g, "\\$&")) });
  await expect(linha.getByText("Custo mudou na última compra")).toBeVisible();
  await page.getByRole("button", { name: /Custo mudou e o preço não/ }).click();
  await expect(linha).toBeVisible();
  // Margem real 12,5% (40,50 sobre 36) abaixo da meta de 35%; sugerido 48,60
  await expect(linha.getByText("12,5%")).toBeVisible();
  await expect(linha.getByText("abaixo da meta")).toBeVisible();
  await expect(linha.getByText("R$ 48,60")).toBeVisible();
  await linha.getByRole("button", { name: "usar" }).click();
  await expect(linha.getByLabel(/Novo preço de/)).toHaveValue("48,60");
  await page.getByRole("button", { name: /Salvar alterações \(1\)/ }).click();
  await expect(page.getByText("1 preço(s) atualizado(s).")).toBeVisible({ timeout: 30_000 });
  const { data: depois } = await servico!.from("nfe_produtos").select("valor_unitario").eq("id", produtoId).single();
  expect(Number(depois!.valor_unitario)).toBe(48.6);

  // Histórico: preço antigo, novo e quem mudou
  const hist = page.getByRole("row", { name: new RegExp(`${NOME.replace(/[()]/g, "\\$&")}.*R\\$ 40,50.*R\\$ 48,60`) });
  await expect(hist).toBeVisible({ timeout: 30_000 });
  await expect(hist.getByText("pela tabela de preços")).toBeVisible();

  // Margem padrão da empresa (opcional)
  if (!(await page.getByLabel("Margem padrão (%)").isVisible())) await page.locator("summary", { hasText: "Margem que quero ganhar" }).click();
  await page.getByLabel("Margem padrão (%)").fill("30");
  await page.getByRole("button", { name: "Salvar padrão" }).click();
  await expect(page.getByText("Margem padrão salva.")).toBeVisible({ timeout: 30_000 });

  // Lista: coluna de margem e filtro
  await page.goto(`${base}?q=${encodeURIComponent(sufixo)}`);
  const naLista = page.getByRole("row", { name: new RegExp(sufixo) });
  await expect(naLista.getByText("35%", { exact: true })).toBeVisible();
  await expect(naLista.getByText("meta 35%")).toBeVisible();

  // Página do produto: margem sobre o custo e histórico completo
  await page.goto(`${base}/${produtoId}`);
  await expect(page.getByText(/margem 35% sobre o custo · meta 35%/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Histórico de preços" })).toBeVisible();

  // Reposição e análise: estoque 12 acima do mínimo 10 e sem vendas — não precisa comprar
  await page.goto(`${base}/analise?ver=grupos`);
  await expect(page.getByRole("heading", { name: "Estoque por grupo" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^Pinus(\d+ sem estoque)?$/ })).toBeVisible();
  await page.getByRole("link", { name: /Sugestão de compra/ }).click();
  await expect(page.getByRole("heading", { name: "Sugestão de compra" })).toBeVisible();
  // Relatórios (PDF e Excel)
  const pdf = await page.request.get(`/api/loja/estoque/relatorio?empresa=${empresaId}&tipo=compras&formato=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const posicao = await page.request.get(`/api/loja/estoque/relatorio?empresa=${empresaId}&tipo=posicao&formato=pdf`);
  expect(posicao.status()).toBe(200);
  const xlsx = await page.request.get(`/api/loja/estoque/relatorio?empresa=${empresaId}&tipo=completo&formato=xlsx`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
});

test("balconista: não vê custos, margens, preços de venda nem a análise", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `balcao@${DOMINIO}`);
  const base = `/e/${empresaId}/loja/produtos`;
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Produtos e estoque" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Custo médio" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Margem" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Preços de venda" })).toHaveCount(0);
  await page.goto(`${base}/precos`);
  await expect(page.getByText("A tabela de preços mostra custos e margens")).toBeVisible();
  await page.goto(`${base}/analise`);
  await expect(page.getByText("A análise do estoque mostra custos e o valor do estoque")).toBeVisible();
  const r = await page.request.get(`/api/loja/estoque/relatorio?empresa=${empresaId}&tipo=posicao&formato=pdf`);
  expect(r.status()).toBe(403);
});
