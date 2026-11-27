import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Honorários do escritório (dados fictícios da demonstração, na Padaria):
 * o administrador cadastra a chave Pix e a ficha do cliente, gera a cobrança
 * do mês, confere e envia; a cobrança tem QR code e Pix copia e cola; o
 * cliente vê e a página de pagamento abre sem login; o pagamento entra na DRE
 * com o recibo; despesa sem linha da DRE fica "a classificar". A equipe sem
 * autorização não vê o menu.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const PADARIA = "11222333000181";

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
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  await page.waitForLoadState("load");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
let configAntes: Record<string, unknown> | null = null;

async function limpar() {
  const { data: cobs } = await servico!.from("honorarios_cobrancas").select("id").eq("empresa_id", empresaId);
  const ids = (cobs ?? []).map((c) => c.id);
  if (ids.length) {
    await servico!.from("escritorio_lancamentos").delete().in("cobranca_id", ids);
    await servico!.from("honorarios_cobrancas").delete().in("id", ids);
  }
  await servico!.from("escritorio_lancamentos").delete().like("descricao", "Teste e2e%");
  // Recibos emitidos pela baixa do teste (sem publicar): saem para não mexer na numeração
  await servico!.from("recibos_honorarios").delete().eq("empresa_id", empresaId).like("descricao", "pagamento da cobrança nº%");
  await servico!.from("honorarios_fichas").delete().eq("empresa_id", empresaId);
  await servico!.from("honorarios_geracoes").delete().gte("competencia", "2000-01-01");
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("documento", PADARIA).single();
  empresaId = data!.id;
  const { data: cfg } = await servico!.from("honorarios_config").select("*").eq("id", 1).single();
  configAntes = cfg;
  // Sem publicar o recibo nos documentos da demonstração e sem gerar sozinho durante o teste
  await servico!.from("honorarios_config").update({ recibo_publicar: false, geracao_automatica: false, pix_chave: null, pix_tipo: null }).eq("id", 1);
  await limpar();
});

test.afterAll(async () => {
  await limpar();
  if (configAntes) {
    const resto: Record<string, unknown> = { ...configAntes };
    delete resto.id;
    delete resto.updated_at;
    await servico!.from("honorarios_config").update(resto).eq("id", 1);
  }
});

test("equipe sem autorização não vê o financeiro do escritório", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio");
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByText("Honorários", { exact: true })).toHaveCount(0);
  await page.goto("/escritorio/honorarios");
  await expect(page).toHaveURL(/\/escritorio\?aviso=sem-acesso-honorarios/);
});

test("ficha, cobrança do mês com Pix, cliente vê, pagamento entra na DRE com recibo", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await entrar(page, `admin@${DOMINIO}`);

  // 1. Chave Pix do escritório
  await page.goto("/escritorio/honorarios/configuracoes");
  await page.getByLabel("Tipo da chave").selectOption("cnpj");
  await page.getByLabel("Chave Pix do escritório").fill("62.935.399/0001-50");
  await page.getByLabel("Nome de quem recebe").fill("Escritório Demonstração");
  await page.getByLabel("Cidade").fill("Porto Nacional");
  await page.getByRole("button", { name: "Salvar Pix" }).click();
  await expect(page.getByText("Configuração salva.").first()).toBeVisible({ timeout: 30_000 });

  // 2. Ficha da Padaria: R$ 850,00 no dia 10, com e-mail para cobrança
  await page.goto(`/escritorio/honorarios/fichas/${empresaId}`);
  await page.getByLabel("Honorário mensal").fill("850,00");
  await page.getByLabel("Dia do vencimento").selectOption("10");
  await page.getByRole("textbox", { name: "E-mail" }).fill("financeiro@padaria.demo.test");
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page).toHaveURL(/\/escritorio\/honorarios\/fichas\?salvo=/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: /PADARIA|Padaria/ }).first()).toBeVisible();

  // 3. Gera a cobrança do mês (fica para conferir)
  await page.goto("/escritorio/honorarios");
  await page.getByRole("button", { name: "Gerar cobranças do mês" }).click();
  await expect(page.getByText(/1 cobrança\(s\) gerada\(s\)/).first()).toBeVisible({ timeout: 30_000 });

  // Vencimento daqui a 5 dias (sem multa e juros no teste; o atraso é testado no banco)
  const futuro = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await servico!.from("honorarios_cobrancas").update({ vencimento: futuro }).eq("empresa_id", empresaId).eq("situacao", "rascunho");

  // 4. Confere e envia
  await page.goto("/escritorio/honorarios/cobrancas?situacao=rascunho");
  await expect(page.getByText(/1 de 1 marcada/)).toBeVisible();
  await page.getByRole("button", { name: "Enviar aos clientes" }).click();
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText("1 cobrança(s) enviada(s) aos clientes.").first()).toBeVisible({ timeout: 30_000 });

  // 5. Detalhe: QR code, Pix copia e cola com a chave e o valor; e-mail na fila do robô
  const { data: cob } = await servico!.from("honorarios_cobrancas").select("id, token_publico, valor").eq("empresa_id", empresaId).single();
  expect(Number(cob!.valor)).toBe(850);
  await page.goto(`/escritorio/honorarios/cobrancas/${cob!.id}`);
  await expect(page.getByRole("img", { name: "QR code do Pix" })).toBeVisible();
  const pix = page.locator("p.font-mono").first();
  await expect(pix).toContainText("0014br.gov.bcb.pix011462935399000150");
  await expect(pix).toContainText("5406850.00");
  await expect(page.getByText("Cobrança enviada")).toBeVisible();

  // 6. O cliente vê a cobrança com o Pix; a página de pagamento abre sem login
  const contexto = await browser.newContext();
  const cliente = await contexto.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto(`/e/${empresaId}/honorarios`);
  await expect(cliente.getByText("R$ 850,00").first()).toBeVisible();
  await expect(cliente.getByRole("button", { name: "Copiar Pix copia e cola" })).toBeVisible();
  const anonimo = await browser.newContext();
  const publica = await anonimo.newPage();
  await publica.goto(`/pagar/${cob!.token_publico}`);
  await expect(publica.getByText("R$ 850,00").first()).toBeVisible();
  await expect(publica.getByRole("img", { name: "QR code do Pix" })).toBeVisible();
  await publica.goto("/pagar/00000000000000000000000000000000");
  await expect(publica.getByText(/não encontrada|404/i).first()).toBeVisible();
  await anonimo.close();

  // 7. Pagamento recebido: entra na DRE e o recibo é emitido
  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Registrar pagamento" }).click();
  await expect(page.getByText(/Pagamento registrado\. Recibo emitido/).first()).toBeVisible({ timeout: 60_000 });
  const { data: lanc } = await servico!.from("escritorio_lancamentos").select("valor, categoria:escritorio_categorias(chave)").eq("cobranca_id", cob!.id);
  expect(lanc!.map((l) => [(l.categoria as unknown as { chave: string }).chave, Number(l.valor)])).toEqual([["HON_MENSAL", 850]]);
  await page.goto("/escritorio/honorarios/dre?periodo=12m");
  await expect(page.getByText("1.01 Honorários mensais")).toBeVisible();

  // 8. Despesa sem linha da DRE fica "a classificar"
  await page.goto("/escritorio/honorarios/lancamentos");
  await page.getByRole("button", { name: "Nova despesa" }).click();
  await page.getByLabel("Descrição").fill("Teste e2e — aluguel da sala");
  await page.getByLabel("Valor").fill("1.200,00");
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/1 lançamento\(s\) a classificar/).first()).toBeVisible({ timeout: 30_000 });

  // 9. O cliente vê o pagamento feito
  await cliente.reload();
  await expect(cliente.getByText("Pagamentos feitos")).toBeVisible();
  await expect(cliente.getByText(/pago em/)).toBeVisible();
  await contexto.close();
});
