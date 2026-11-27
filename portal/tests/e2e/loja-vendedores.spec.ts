import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Vendedores e comissões na loja (dados fictícios da Madeireira Reflorestar):
 *  - o dono cadastra vendedores com o % de comissão e passa a exigir o vendedor;
 *  - o balconista faz o orçamento com a vendedora; sem vendedor, não salva;
 *  - o orçamento vira venda no caixa com a mesma vendedora e a comissão sai
 *    com o % dela, sobre os produtos sem o frete;
 *  - o dono vê as comissões, troca o vendedor com motivo e lança no Contas a pagar;
 *  - cancelar o orçamento pede o nome e a senha de quem autoriza (senha errada recusa).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";
const N = Date.now().toString(36).slice(-5);
const CARLA = `Carla E2E ${N}`;
const DIEGO = `Diego E2E ${N}`;

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
let orcamentoId = "";
let vendaId = "";
test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
});
// Não deixa a exigência ligada para os outros testes da loja
test.afterAll(async () => {
  if (empresaId) await servico!.from("gestao_config").update({ vendedor_obrigatorio: false }).eq("empresa_id", empresaId);
});

test("dono: cadastra os vendedores com a comissão e passa a exigir o vendedor", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/vendedores`);
  for (const [nome, pct] of [
    [CARLA, "5"],
    [DIEGO, "2,5"],
  ]) {
    await page.getByRole("button", { name: "Novo vendedor" }).click();
    await page.fill("#vd-nome", nome);
    await page.fill("#vd-comissao", pct);
    await page.getByRole("button", { name: "Salvar vendedor" }).click();
    await expect(page.getByTestId("linha-vendedor").filter({ hasText: nome })).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.getByTestId("linha-vendedor").filter({ hasText: DIEGO })).toContainText("2,5%");
  const exigir = page.getByLabel("Exigir o vendedor");
  // A caixinha muda depois que o servidor confirma
  if (!(await exigir.isChecked())) {
    await exigir.click();
    await expect(page.getByText("Agora todo orçamento e venda pede o vendedor.")).toBeVisible({ timeout: 30_000 });
  }
  await expect(exigir).toBeChecked({ timeout: 30_000 });
});

test("balcão: orçamento pede o vendedor; vira venda com a mesma vendedora e a comissão dela", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/orcamento`);
  await expect(page.getByRole("heading", { name: "Novo orçamento" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Buscar produto").fill("mourão");
  await page.getByRole("button", { name: /Mourão de eucalipto/ }).click();
  await page.locator('input[id^="q-"]').first().fill("10");
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await expect(page.getByText("Escolha o vendedor.")).toBeVisible();

  await page.getByLabel("Vendedor").selectOption({ label: CARLA });
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await page.waitForURL(/\/loja\/vendas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  orcamentoId = page.url().split("/").pop()!;
  await expect(page.getByTestId("card-vendedor")).toContainText(CARLA);

  // Vender o orçamento: a vendedora vem junto
  await page.getByRole("link", { name: "Vender este orçamento" }).click();
  const abrir = page.getByRole("button", { name: "Abrir o caixa" });
  await expect(abrir.or(page.getByLabel("Buscar produto"))).toBeVisible({ timeout: 30_000 });
  if (await abrir.isVisible()) {
    await page.getByLabel("Nome do caixa").fill("Caixa E2E vendedores");
    await page.getByLabel("Troco inicial na gaveta").fill("100,00");
    await abrir.click();
  }
  await expect(page.getByLabel("Vendedor")).toHaveValue(/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByLabel("Vendedor").locator("option:checked")).toHaveText(CARLA);
  await page.getByRole("group", { name: "Formas de pagamento" }).getByRole("button", { name: /PIX/ }).click();
  await page.getByRole("button", { name: "Concluir venda" }).click();
  await expect(page.getByRole("dialog")).toContainText(/Venda nº \d+/, { timeout: 30_000 });

  const { data: v } = await servico!.from("vendas").select("id, subtotal, desconto, loja_vendedor_id").eq("orcamento_id", orcamentoId).eq("tipo", "venda").single();
  vendaId = v!.id;
  const { data: carla } = await servico!.from("loja_vendedores").select("id").eq("empresa_id", empresaId).eq("nome", CARLA).single();
  expect(v!.loja_vendedor_id).toBe(carla!.id);
  const { data: c } = await servico!.from("venda_comissoes").select("percentual, valor").eq("venda_id", vendaId).single();
  expect(Number(c!.percentual)).toBe(5);
  expect(Number(c!.valor)).toBeCloseTo(Math.round((Number(v!.subtotal) - Number(v!.desconto)) * 5) / 100, 2);
});

test("dono: vê as comissões, troca o vendedor com motivo e lança no Contas a pagar", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!vendaId, "Depende da venda do teste anterior.");
  await entrar(page, `madeireira@${DOMINIO}`);
  const { data: carla } = await servico!.from("loja_vendedores").select("id").eq("empresa_id", empresaId).eq("nome", CARLA).single();
  await page.goto(`/e/${empresaId}/loja/comissoes?vendedor=${carla!.id}`);
  await expect(page.getByTestId("linha-comissao")).toHaveCount(1);
  await expect(page.getByTestId("resumo-vendedor")).toContainText(CARLA);

  // Troca: a comissão passa para o Diego (2,5%) e fica no histórico
  await page.goto(`/e/${empresaId}/loja/vendas/${vendaId}`);
  await page.getByRole("button", { name: "Trocar vendedor" }).click();
  await page.getByLabel("Novo vendedor").selectOption({ label: DIEGO });
  await page.getByLabel("Motivo").fill("O atendimento foi do Diego (E2E)");
  await page.getByRole("button", { name: "Confirmar troca" }).click();
  await expect(page.getByTestId("card-vendedor")).toContainText(DIEGO, { timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Trocas de vendedor" })).toContainText("O atendimento foi do Diego (E2E)");
  await expect(page.getByTestId("card-vendedor")).toContainText("2,5%");

  // Lançar no Contas a pagar (uma conta por vendedor)
  const { data: diego } = await servico!.from("loja_vendedores").select("id").eq("empresa_id", empresaId).eq("nome", DIEGO).single();
  await page.goto(`/e/${empresaId}/loja/comissoes?vendedor=${diego!.id}`);
  await page.getByRole("button", { name: "Lançar no Contas a pagar" }).click();
  const conta = await page.locator("#com-cat option").nth(1).getAttribute("value");
  if (!(await page.locator("#com-cat").inputValue())) await page.selectOption("#com-cat", conta!);
  await page.getByRole("dialog").getByRole("button", { name: /^Lançar R\$/ }).click();
  await expect(page.getByText(/conta\(s\) a pagar criada\(s\)/)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/e/${empresaId}/loja/vendas/${vendaId}`);
  await expect(page.getByTestId("card-vendedor")).toContainText("lançada no Contas a pagar");
});

test("cancelar o orçamento pede o nome e a senha de quem autoriza", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `balcao@${DOMINIO}`);
  // Um orçamento novo (com vendedor, porque a loja exige)
  await page.goto(`/e/${empresaId}/loja/orcamento`);
  await page.getByLabel("Buscar produto").fill("mourão");
  await page.getByRole("button", { name: /Mourão de eucalipto/ }).click();
  await page.locator('input[id^="q-"]').first().fill("2");
  await page.getByLabel("Vendedor").selectOption({ label: DIEGO });
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await page.waitForURL(/\/loja\/vendas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const id = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "Cancelar orçamento" }).click();
  await page.getByLabel("Motivo").fill("Cliente desistiu (E2E)");
  await expect(page.getByLabel("Quem autoriza")).toBeVisible();
  await page.getByLabel("Senha").fill("senha-errada-E2E");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar orçamento" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Senha incorreta." })).toBeVisible({ timeout: 30_000 });
  const { data: aberto } = await servico!.from("vendas").select("status").eq("id", id).single();
  expect(aberto!.status).toBe("aberto");

  // O dono digita a senha dele no balcão
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar orçamento" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
  const { data: cancelado } = await servico!.from("vendas").select("status, cancelamento_autorizado_por, cancelada_por").eq("id", id).single();
  expect(cancelado!.status).toBe("cancelada");
  expect(cancelado!.cancelamento_autorizado_por).not.toBe(cancelado!.cancelada_por);
});
