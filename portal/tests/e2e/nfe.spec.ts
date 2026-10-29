import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Emissão de NF-e pelo portal (dados fictícios da demonstração, Fazenda Exemplo,
 * produtor rural de MT):
 *  - a equipe vê a emissão desligada (sem certificado), cadastra um produto
 *    pelo modelo e não consegue ligar a emissão sem o certificado;
 *  - com a emissão ligada (certificado fictício gravado pelo teste), a equipe
 *    preenche a venda de milho, confere o ICMS, o FUNRURAL e a guia do ICMS
 *    antes de emitir; neste ambiente nenhuma consulta fiscal sai
 *    (NOTAS_AUTOMATICAS_SEM_REDE), então a nota fica "Sem resposta" com o
 *    aviso de que nada foi enviado à SEFAZ — nada é simulado;
 *  - cliente de outra empresa não vê a emissão da Fazenda.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const FAZENDA = "PRODUTOR RURAL EXEMPLO (DEMONSTRAÇÃO)";

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
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.skip(process.env.NOTAS_AUTOMATICAS_SEM_REDE !== "1", "Só roda com as consultas fiscais desligadas neste ambiente.");

let empresaId = "";
let documento = "";

const OPERACAO_FRETE = "Venda de milho para outro estado (DEMO)";

async function limpar() {
  if (!empresaId) return;
  await servico!.from("nfe_guias").delete().eq("empresa_id", empresaId);
  await servico!.from("nfe_emissoes").delete().eq("empresa_id", empresaId);
  await servico!.from("nfe_produtos").delete().eq("empresa_id", empresaId).like("codigo", "%E2E%");
  await servico!.from("nfe_config").update({ ativa: false }).eq("empresa_id", empresaId);
  await servico!.from("certificados_digitais").delete().eq("empresa_id", empresaId).eq("titular", "CERTIFICADO FICTICIO (E2E)");
  await servico!.from("jobs").delete().eq("empresa_id", empresaId).in("tipo", ["emitir_nfe", "evento_nfe"]);
  await servico!.from("nfe_operacoes").update({ frete_icms_retido: false }).eq("empresa_id", empresaId).eq("nome", OPERACAO_FRETE);
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, documento").eq("razao_social", FAZENDA).single();
  empresaId = data!.id;
  documento = data!.documento;
  await limpar();
});
test.afterAll(limpar);

test("equipe: emissão desligada sem certificado, produto pelo modelo e bloqueio ao ligar", async ({ page }) => {
  test.setTimeout(300_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto`);
  await expect(page.getByRole("heading", { name: "Notas de produto (NF-e)", level: 1 })).toBeVisible();
  await expect(page.getByText("Emissão desconectada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Emitir NF-e" })).toHaveCount(0);

  await page.getByRole("link", { name: /Configurar emissão/ }).first().click();
  await page.waitForURL(/\/notas-produto\/configuracao/);
  await expect(page.getByText("Sem certificado digital válido")).toBeVisible();
  await expect(page.getByText("Fazenda Boa Esperança (DEMO)")).toBeVisible();
  // (o nome também aparece na escolha da regra fiscal própria dos produtos)
  await expect(page.getByText("Venda de milho para outro estado (DEMO)", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^MILHO EM GRAOS/ })).toBeVisible();

  // Produto novo a partir do modelo (NCM, unidade e peso preenchidos)
  await page.getByRole("button", { name: "Novo produto" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#pr-modelo").selectOption({ label: "Soja em grão (tonelada)" });
  await expect(dialogo.locator("#pr-ncm")).toHaveValue("12019000");
  await expect(dialogo.locator("#pr-peso")).toHaveValue("1000");
  await dialogo.locator("#pr-cod").fill("SOJA-T-E2E");
  await dialogo.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto salvo.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: /\(SOJA-T-E2E\)/ })).toBeVisible();

  await page.getByLabel(/Emissão ligada/).check();
  await page.fill("#autorizacao_texto", "Autorização fictícia do teste automático (E2E).");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText(/Cadastre o certificado digital A1 da empresa/)).toBeVisible({ timeout: 30_000 });
  const { data: cfg } = await servico!.from("nfe_config").select("ativa").eq("empresa_id", empresaId).single();
  expect(cfg!.ativa).toBe(false);
});

test("equipe: com a emissão ligada confere ICMS, FUNRURAL e guia e vê que nada saiu deste ambiente", async ({ page }) => {
  test.setTimeout(300_000);
  // Liga a emissão pelo banco com um certificado FICTÍCIO (o teste não tem certificado real)
  await servico!.from("certificados_digitais").insert({
    empresa_id: empresaId,
    titular: "CERTIFICADO FICTICIO (E2E)",
    documento,
    impressao_digital: "D".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (E2E).",
  });
  await servico!
    .from("nfe_config")
    .update({ ativa: true, autorizacao_texto: "Teste automático (E2E).", autorizado_em: new Date().toISOString() })
    .eq("empresa_id", empresaId);
  // A operação retém o ICMS do frete (frete de caminhoneiro autônomo contratado pelo vendedor)
  await servico!.from("nfe_operacoes").update({ frete_icms_retido: true, frete_aliquota: 12, frete_cfop: "6360" }).eq("empresa_id", empresaId).eq("nome", OPERACAO_FRETE);

  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto`);
  await expect(page.getByText("Emissão em teste (homologação)")).toBeVisible();
  await page.getByRole("link", { name: "Emitir NF-e" }).click();
  await page.waitForURL(/\/notas-produto\/nova/);

  // Único comprador da demonstração (Cerealista Exemplo, GO)
  await page.locator("#destinatario").selectOption({ index: 1 });
  await page.locator("#p-1").selectOption({ label: "MILHO EM GRAOS (SC)" });
  await page.fill("#q-1", "1000");
  await page.fill("#v-1", "55,00");
  // O ICMS do frete só é pedido quando o vendedor contrata o frete; frete por conta do comprador sai sem ele
  await page.locator("#modalidade").selectOption("0");
  await expect(page.locator("#frete-servico")).toBeVisible();
  await page.locator("#modalidade").selectOption("1");
  await expect(page.locator("#frete-servico")).toHaveCount(0);
  await expect(page.getByText(/não sai nesta nota/)).toBeVisible();
  await page.getByRole("button", { name: "Conferir e emitir" }).click();

  const previa = page.getByRole("dialog");
  await expect(previa.getByText("Confira os valores antes de emitir")).toBeVisible({ timeout: 30_000 });
  await expect(previa.getByText("R$ 55.000,00").first()).toBeVisible();
  await expect(previa.getByText(/ICMS da operação/)).toBeVisible();
  await expect(previa.getByText("R$ 6.600,00").first()).toBeVisible();
  await expect(previa.getByText(/FUNRURAL/).first()).toBeVisible();
  await previa.getByRole("button", { name: "Emitir nota de teste" }).click();

  await page.waitForURL(/\/notas-produto\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText(/nada foi enviado à SEFAZ/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Sem resposta").first()).toBeVisible();
  const { data: notas } = await servico!.from("nfe_emissoes").select("situacao, chave, protocolo, valor_total, ambiente").eq("empresa_id", empresaId);
  expect(notas).toEqual([expect.objectContaining({ situacao: "falha", protocolo: null, valor_total: 55000, ambiente: "homologacao" })]);
  const { data: dados } = await servico!.from("nfe_emissoes").select("dados").eq("empresa_id", empresaId).single();
  const transporte = (dados!.dados as { transporte: { modalidade: number; icmsFrete: unknown } }).transporte;
  expect(transporte.modalidade).toBe(1);
  expect(transporte.icmsFrete ?? null).toBeNull();
  const { count } = await servico!.from("nfe_guias").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  expect(count).toBe(0);
});

test("cliente de outra empresa não vê a emissão da Fazenda", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `cliente2@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto`);
  await expect(page.getByRole("heading", { name: "Notas de produto (NF-e)", level: 1 })).toHaveCount(0);
  await expect(page.getByText("Fazenda Boa Esperança (DEMO)")).toHaveCount(0);
  await page.goto(`/e/${empresaId}/notas-produto/configuracao`);
  await expect(page.getByText("Venda de milho para outro estado (DEMO)")).toHaveCount(0);
});
