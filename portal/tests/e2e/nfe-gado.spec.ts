import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Venda de gado com GTA (dados fictícios da demonstração, produtor rural de MT):
 *  - a equipe cria a operação pelo modelo "Venda de gado" (CFOP, FUNRURAL, PIS/Cofins
 *    do produtor e "Exige GTA" preenchidos; o ICMS fica para o escritório escolher,
 *    com os pontos a conferir em destaque) e o produto pelo modelo "Bovino vivo";
 *  - na emissão, o campo da GTA aparece e a nota não sai sem ele; com a GTA, a
 *    prévia mostra o texto das informações complementares e a nota guarda a GTA;
 *  - neste ambiente nenhuma consulta fiscal sai (NOTAS_AUTOMATICAS_SEM_REDE).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const FAZENDA = "PRODUTOR RURAL EXEMPLO (DEMONSTRAÇÃO)";
const OPERACAO = "Venda de gado - outro estado (E2E)";

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

async function limpar() {
  if (!empresaId) return;
  await servico!.from("nfe_guias").delete().eq("empresa_id", empresaId);
  await servico!.from("nfe_emissoes").delete().eq("empresa_id", empresaId);
  await servico!.from("jobs").delete().eq("empresa_id", empresaId).in("tipo", ["emitir_nfe", "evento_nfe"]);
  await servico!.from("nfe_produtos").delete().eq("empresa_id", empresaId).eq("codigo", "BOI-E2E");
  await servico!.from("nfe_operacoes").delete().eq("empresa_id", empresaId).eq("nome", OPERACAO);
  await servico!.from("nfe_config").update({ ativa: false }).eq("empresa_id", empresaId);
  await servico!.from("certificados_digitais").delete().eq("empresa_id", empresaId).eq("titular", "CERTIFICADO FICTICIO (E2E GADO)");
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, documento").eq("razao_social", FAZENDA).single();
  empresaId = data!.id;
  documento = data!.documento;
  await limpar();
});
test.afterAll(limpar);

test("equipe cria a venda de gado pelo modelo e a nota só sai com a GTA", async ({ page }) => {
  test.setTimeout(300_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto/configuracao`);

  // Operação pelo modelo: o que é padrão vem preenchido; o ICMS fica para o escritório
  await page.getByRole("button", { name: "Nova operação" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.locator("#op-modelo").selectOption({ label: "Venda de gado (bovinos vivos) para outro estado (6101, com GTA e FUNRURAL)" });
  await expect(dialogo.getByText("Confira antes de salvar")).toBeVisible();
  await expect(dialogo.getByText(/Lei 1\.173\/2000/)).toBeVisible();
  await expect(dialogo.locator("#op-cfop")).toHaveValue("6101");
  await expect(dialogo.getByLabel(/Exige GTA/)).toBeChecked();
  await expect(dialogo.locator('input[name="incide_funrural"]')).toBeChecked();
  await expect(dialogo.locator("#op-pis")).toHaveValue("08");
  await expect(dialogo.locator("#op-cst")).toHaveValue("");
  await dialogo.locator("#op-nome").fill(OPERACAO);
  await dialogo.locator("#op-cst").selectOption("40");
  await dialogo.locator("#op-class").selectOption("410014");
  await dialogo.getByRole("button", { name: "Salvar operação" }).click();
  await expect(page.getByText("Operação salva.").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("listitem").filter({ hasText: OPERACAO })).toContainText("exige GTA");
  const { data: op } = await servico!.from("nfe_operacoes").select("cfop, icms_cst, pis_cst, cofins_cst, incide_funrural, exige_gta").eq("empresa_id", empresaId).eq("nome", OPERACAO).single();
  expect(op).toEqual({ cfop: "6101", icms_cst: "40", pis_cst: "08", cofins_cst: "08", incide_funrural: true, exige_gta: true });

  // Produto pelo modelo "Bovino vivo"
  await page.getByRole("button", { name: "Novo produto" }).click();
  const dlgProduto = page.getByRole("dialog");
  await dlgProduto.locator("#pr-modelo").selectOption({ label: "Bovino vivo — gado de corte (por cabeça)" });
  await expect(dlgProduto.locator("#pr-ncm")).toHaveValue("01022990");
  await expect(dlgProduto.locator("#pr-un")).toHaveValue("CB");
  await dlgProduto.locator("#pr-cod").fill("BOI-E2E");
  await dlgProduto.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByText("Produto salvo.").first()).toBeVisible({ timeout: 30_000 });

  // Emissão ligada pelo banco com um certificado FICTÍCIO (o teste não tem certificado real)
  await servico!.from("certificados_digitais").insert({
    empresa_id: empresaId,
    titular: "CERTIFICADO FICTICIO (E2E GADO)",
    documento,
    impressao_digital: "E".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (E2E).",
  });
  await servico!.from("nfe_config").update({ ativa: true, autorizacao_texto: "Teste automático (E2E).", autorizado_em: new Date().toISOString() }).eq("empresa_id", empresaId);

  await page.goto(`/e/${empresaId}/notas-produto/nova`);
  await page.locator("#operacao").selectOption({ label: OPERACAO });
  await page.locator("#destinatario").selectOption({ index: 1 });
  await page.locator("#p-1").selectOption({ label: "BOVINO VIVO (CB)" });
  await page.fill("#q-1", "20");
  await page.fill("#v-1", "3.150,00");
  await page.locator("#modalidade").selectOption("1");

  // Sem a GTA a nota não sai
  await expect(page.getByRole("heading", { name: /GTA — Guia de Trânsito Animal/ })).toBeVisible();
  await page.getByRole("button", { name: "Conferir e emitir" }).click();
  await expect(page.getByText("Informe o número da GTA (Guia de Trânsito Animal) dos animais.")).toBeVisible();

  // Com duas GTAs: a prévia mostra o texto das informações complementares
  await page.getByLabel("Número da GTA").first().fill("123.456");
  await page.getByLabel("Série").first().fill("a");
  await page.getByRole("button", { name: "GTA", exact: true }).click();
  await page.getByLabel("Número da GTA").nth(1).fill("7788");
  await page.getByRole("button", { name: "Conferir e emitir" }).click();
  const previa = page.getByRole("dialog");
  await expect(previa.getByText("Confira os valores antes de emitir")).toBeVisible({ timeout: 30_000 });
  await expect(previa.getByText("Animais acompanhados de GTA nº 123456, série A (MT); GTA nº 7788 (MT).")).toBeVisible();
  await expect(previa.getByText("R$ 63.000,00").first()).toBeVisible();
  await previa.getByRole("button", { name: "Emitir nota de teste" }).click();

  await page.waitForURL(/\/notas-produto\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText(/nada foi enviado à SEFAZ/)).toBeVisible({ timeout: 90_000 });
  const { data: nota } = await servico!.from("nfe_emissoes").select("dados, pedido").eq("empresa_id", empresaId).single();
  expect((nota!.dados as { gtas: unknown }).gtas).toEqual([
    { numero: "123456", serie: "A", uf: "MT" },
    { numero: "7788", serie: null, uf: "MT" },
  ]);
});
