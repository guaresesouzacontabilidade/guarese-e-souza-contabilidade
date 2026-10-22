import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * CT-e na demonstração (Grãos Cerrado — comercial de grãos de MT que também
 * transporta, como a VAP; dados fictícios). A emissão está DESLIGADA (sem
 * certificado):
 *  - o escritório vê a configuração e as operações do frete, e o portal não
 *    liga a emissão sem o certificado;
 *  - o dono abre o formulário em modo de conferência: a própria empresa como
 *    remetente, o comprador como destinatário, e o cálculo do frete (ICMS e
 *    IBS/CBS) aparece sem o botão de enviar — nada vai à SEFAZ;
 *  - o CT-e a partir da ordem de carregamento vem com o comprador, quem paga,
 *    a carga e o peso da balança;
 *  - cliente de outra empresa não vê o CT-e.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const GRAOS = "COMERCIAL DE GRAOS CERRADO EXEMPLO LTDA (DEMONSTRAÇÃO)";

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

/** Escolhe a opção do campo pelo começo do texto (os nomes vêm com o CNPJ). */
async function escolher(page: Page, campo: string, texto: string) {
  const valor = await page.getByLabel(campo).locator("option", { hasText: texto }).first().getAttribute("value");
  await page.getByLabel(campo).selectOption(valor!);
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
let documentoEmpresa = "";
let propriaJaExistia = false;

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, documento").eq("razao_social", GRAOS).single();
  empresaId = data!.id;
  documentoEmpresa = data!.documento;
  const { count } = await servico!.from("nfe_destinatarios").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("documento", documentoEmpresa);
  propriaJaExistia = Boolean(count);
});

test.afterAll(async () => {
  // A própria empresa cadastrada como participante pelo teste sai (a demonstração fica como estava)
  if (!propriaJaExistia) await servico!.from("nfe_destinatarios").delete().eq("empresa_id", empresaId).eq("documento", documentoEmpresa);
});

test("escritório: configuração e operações do frete; sem certificado a emissão não liga", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/cte/configuracao`);
  await expect(page.getByRole("heading", { name: "Configurar emissão de CT-e" })).toBeVisible();
  await expect(page.getByText("Sem certificado digital válido")).toBeVisible();
  await expect(page.getByText("Frete de grãos para outro estado (DEMO)")).toBeVisible();
  await expect(page.getByLabel("RNTRC (registro na ANTT)")).toHaveValue("12345678");
  await page.getByText("Emissão de CT-e ligada").click();
  await page.getByRole("textbox", { name: "Autorização do cliente" }).fill("Teste automático: autorização fictícia da demonstração");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText(/certificado digital A1 da empresa \(válido\)/).first()).toBeVisible({ timeout: 30_000 });
  const { data: cfg } = await servico!.from("cte_config").select("ativa").eq("empresa_id", empresaId).single();
  expect(cfg!.ativa).toBe(false);

  // A carteira do escritório lista a transportadora
  await page.goto("/escritorio/cte");
  await expect(page.getByRole("link", { name: "Grãos Cerrado (DEMO)" })).toBeVisible();
});

test("dono: modo de conferência calcula o frete e não envia nada à SEFAZ", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `graos@${DOMINIO}`);
  await page.goto(`/e/${empresaId}`);
  await expect(page.getByRole("link", { name: "Emitir CT-e (frete)" }).first()).toBeVisible();
  await page.goto(`/e/${empresaId}/cte`);
  await expect(page.getByText("Emissão desconectada")).toBeVisible();
  await page.getByRole("link", { name: "Conferir um frete" }).click();
  await expect(page.getByText("Emissão desconectada: modo de conferência")).toBeVisible();

  // NF-e que não está no portal: a chave entra na lista e o resto é à mão
  await page.getByLabel("Chave da NF-e").fill("5126 1055 7770 8800 0144 5500 1000 0000 1512 3456 7890");
  await page.getByRole("button", { name: "Buscar NF-e" }).click();
  await expect(page.getByLabel("Chaves das NF-e da carga")).toHaveValue("51261055777088000144550010000000151234567890");

  await escolher(page, "Operação do frete", "Frete de grãos para outro estado");
  await page.getByRole("button", { name: "A própria empresa" }).click();
  await expect(page.getByLabel("Remetente (quem envia a carga)").locator("option:checked")).toContainText("COMERCIAL DE GRAOS CERRADO", { timeout: 30_000 });
  await escolher(page, "Destinatário (quem recebe a carga)", "TRADING EXEMPLO");
  await page.getByLabel("Quem paga o frete (tomador)").selectOption("destinatario");
  await page.getByLabel("Valor total do frete (R$)").fill("4.500,00");
  await page.getByLabel("Produto predominante").fill("SOJA EM GRAOS");
  await page.getByLabel("Peso (kg)").fill("36.020");
  await page.getByLabel("Valor da carga (R$)").fill("77.142,83");
  await page.getByRole("button", { name: "Conferir os valores" }).click();

  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText("Emissão desligada: só a conferência dos valores")).toBeVisible({ timeout: 30_000 });
  await expect(dialogo.getByText("6353 — PRESTACAO DE SERVICO DE TRANSPORTE")).toBeVisible();
  await expect(dialogo.getByText("Sorriso/MT → Rio Verde/GO")).toBeVisible();
  await expect(dialogo.getByText("R$ 540,00")).toBeVisible();
  // Base do ICMS e valor do frete
  await expect(dialogo.getByText("R$ 4.500,00")).toHaveCount(2);
  await expect(dialogo.getByRole("button", { name: /Emitir CT-e/ })).toHaveCount(0);
  const { count } = await servico!.from("cte_emissoes").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  expect(count).toBe(0);
});

test("CT-e a partir da ordem de carregamento: comprador, quem paga, carga e peso da balança", async ({ page }) => {
  test.setTimeout(180_000);
  const { data: ordem } = await servico!.from("ordens_carregamento").select("id, numero").eq("empresa_id", empresaId).eq("numero", 1).single();
  await entrar(page, `graos@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/carregamentos/${ordem!.id}`);
  await page.getByRole("link", { name: "Emitir CT-e", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Emitir CT-e da ordem de carregamento nº ${ordem!.numero}` })).toBeVisible();
  await expect(page.getByLabel("Destinatário (quem recebe a carga)").locator("option:checked")).toContainText("TRADING EXEMPLO");
  await expect(page.getByLabel("Quem paga o frete (tomador)")).toHaveValue("destinatario");
  await expect(page.getByLabel("Produto predominante")).toHaveValue("SOJA EM GRAOS");
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("36.020");
  await expect(page.getByLabel("Observações")).toHaveValue(/Ordem de carregamento nº 1 - placa QBA1C23/);
});

test("isolamento: cliente de outra empresa não vê o CT-e", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  for (const rota of ["/cte", "/cte/nova", "/cte/configuracao"]) {
    const r = await page.goto(`/e/${empresaId}${rota}`);
    expect(r?.status(), `rota ${rota} deve responder 404`).toBe(404);
  }
  expect((await page.request.get(`/api/cte/${empresaId}/00000000-0000-4000-8000-000000000000`)).status()).toBe(403);
});
