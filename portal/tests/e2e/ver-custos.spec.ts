import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Permissão "Ver custos e margens" (dados fictícios da demonstração, Madeireira
 * Reflorestar):
 *  - a balconista passa a gerenciar a loja, sem ver custos: cadastra e muda o
 *    preço, mas não vê custo médio, margem, valor do estoque, tabela de preços,
 *    análise nem a entrada por nota; salvar o produto não mexe no custo; o
 *    relatório com custos é recusado;
 *  - o dono marca "Ver custos e margens" para ela em Usuários e permissões e ela
 *    passa a ver o custo.
 * No fim, as permissões e o preço voltam como estavam.
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

let empresaId = "";
let membroId = "";
let permissoesAntes: string[] = [];
let produto: { id: string; descricao: string; valor_unitario: number; preco_custo: number } | null = null;

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = emp!.id;
  const { data: perfil } = await servico!.from("perfis").select("id").eq("email", `balcao@${DOMINIO}`).single();
  const { data: membro } = await servico!.from("empresa_membros").select("id, permissoes").eq("empresa_id", empresaId).eq("user_id", perfil!.id).single();
  membroId = membro!.id;
  permissoesAntes = membro!.permissoes as string[];
  // A balconista passa a gerenciar a loja, sem ver custos
  const novas = [...new Set([...permissoesAntes, "gestao.vender", "gestao.gerenciar"])].filter((p) => p !== "gestao.custos");
  await servico!.from("empresa_membros").update({ permissoes: novas }).eq("id", membroId);
  const { data: p } = await servico!
    .from("nfe_produtos")
    .select("id, descricao, valor_unitario, preco_custo")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .gt("preco_custo", 0)
    .gt("valor_unitario", 0)
    .order("descricao")
    .limit(1)
    .single();
  produto = { id: p!.id, descricao: p!.descricao, valor_unitario: Number(p!.valor_unitario), preco_custo: Number(p!.preco_custo) };
});

test.afterAll(async () => {
  if (membroId) await servico!.from("empresa_membros").update({ permissoes: permissoesAntes }).eq("id", membroId);
  if (produto) await servico!.from("nfe_produtos").update({ valor_unitario: produto.valor_unitario, preco_custo: produto.preco_custo }).eq("id", produto.id);
});

test("quem gerencia a loja sem a permissão não vê custos nem margens", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  const base = `/e/${empresaId}/loja/produtos`;

  // Lista: cadastra produto e ajusta estoque, mas sem custo, margem e valor do estoque
  await page.goto(base);
  await expect(page.getByRole("button", { name: "Novo produto" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Ajustar estoque" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Custo médio" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Margem" })).toHaveCount(0);
  await expect(page.getByText("Valor do estoque (custo)")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Entrada de mercadorias" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Preços de venda" })).toHaveCount(0);

  // Ficha do produto: sem custo médio; o cadastro não mostra custo nem margem
  await page.goto(`${base}/${produto!.id}`);
  await expect(page.getByRole("heading", { name: produto!.descricao })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Custo médio")).toHaveCount(0);
  await expect(page.getByText(/sobre o custo/)).toHaveCount(0);
  await page.getByRole("button", { name: "Editar" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/Preço de venda/)).toBeVisible();
  await expect(dialogo.getByText(/Custo de compra/)).toHaveCount(0);
  await expect(dialogo.getByText(/Margem que quero ganhar/)).toHaveCount(0);
  // Muda o preço e salva: o custo guardado continua o mesmo
  const novoPreco = (produto!.valor_unitario + 1).toFixed(2).replace(".", ",");
  await dialogo.getByLabel(/Preço de venda/).fill(novoPreco);
  await dialogo.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => {
      const { data } = await servico!.from("nfe_produtos").select("valor_unitario, preco_custo").eq("id", produto!.id).single();
      return [Number(data!.valor_unitario), Number(data!.preco_custo)];
    }, { timeout: 30_000 })
    .toEqual([produto!.valor_unitario + 1, produto!.preco_custo]);

  // Ajustar estoque: entrada sem o campo de custo
  await page.getByRole("button", { name: "Ajustar estoque" }).click();
  await page.getByLabel("Tipo").selectOption("entrada_manual");
  await expect(page.getByText("Custo unitário (opcional)")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Tabela de preços, análise e entrada por nota: fechadas, com a explicação
  await page.goto(`${base}/precos`);
  await expect(page.getByText("A tabela de preços mostra custos e margens")).toBeVisible({ timeout: 60_000 });
  await page.goto(`${base}/analise`);
  await expect(page.getByText("A análise do estoque mostra custos e o valor do estoque")).toBeVisible({ timeout: 60_000 });
  await page.goto(`${base}/entrada-nota`);
  await expect(page.getByText("A entrada por nota mostra o custo das mercadorias")).toBeVisible({ timeout: 60_000 });
  // Relatório do estoque (com custos): recusado
  const r = await page.request.get(`/api/loja/estoque/relatorio?empresa=${empresaId}&tipo=posicao`);
  expect(r.status()).toBe(403);
});

test("o dono libera Ver custos e margens e a funcionária passa a ver o custo", async ({ browser }) => {
  test.setTimeout(240_000);
  const dono = await browser.newPage();
  await entrar(dono, `madeireira@${DOMINIO}`);
  await dono.goto(`/e/${empresaId}/configuracoes?aba=usuarios`);
  await dono.getByRole("button", { name: /Ações para Balconista/ }).click();
  await dono.getByRole("menuitem", { name: "Editar permissões" }).click();
  const dialogo = dono.getByRole("dialog");
  const opcao = dialogo.getByRole("checkbox", { name: /Ver custos e margens/ });
  await expect(opcao).not.toBeChecked();
  await opcao.check();
  await dialogo.getByRole("button", { name: "Salvar permissões" }).click();
  await expect(dono.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => ((await servico!.from("empresa_membros").select("permissoes").eq("id", membroId).single()).data!.permissoes as string[]).includes("gestao.custos"), {
      timeout: 30_000,
    })
    .toBe(true);
  await dono.close();

  const funcionaria = await browser.newPage();
  await entrar(funcionaria, `balcao@${DOMINIO}`);
  await funcionaria.goto(`/e/${empresaId}/loja/produtos`);
  await expect(funcionaria.getByRole("columnheader", { name: "Custo médio" })).toBeVisible({ timeout: 60_000 });
  await expect(funcionaria.getByText("Valor do estoque (custo)")).toBeVisible();
  await expect(funcionaria.getByRole("link", { name: "Preços de venda" })).toBeVisible();
  await funcionaria.close();
});
