import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Nota no cartão e cupom fiscal (dados fictícios da demonstração, Madeireira
 * Reflorestar, TO):
 *  - o escritório cria a operação "Serve para: Cupom fiscal (NFC-e)", informa a
 *    série do cupom, liga o cupom (homologação) e liga a regra "exigir nota no
 *    cartão de crédito" na loja;
 *  - o dono da loja vê a regra, mas não consegue mudá-la;
 *  - no caixa, a venda no cartão de crédito sai obrigatoriamente com nota e o
 *    cupom fica ligado à venda; no PIX a nota continua opcional;
 *  - sem rede, nada vai à SEFAZ: a tela mostra a situação real e o cupom não
 *    imprime antes da autorização.
 * O certificado é FICTÍCIO e só existe durante o teste.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";
const PREFIXO = "Balcão cupom E2E";
const OPERACAO = `${PREFIXO} ${Date.now().toString().slice(-6)}`;
const TITULAR = "CERTIFICADO FICTICIO (E2E CUPOM)";

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
let documento = "";

/** Volta a madeireira ao estado da demonstração (sem cupom, sem regra, sem certificado). */
async function limpar() {
  const s = servico!;
  await s.from("gestao_config").update({ nota_obrigatoria_formas: [], nfce_operacao_id: null, documento_padrao: "nfe" }).eq("empresa_id", empresaId);
  await s.from("nfe_config").update({ nfce_ativa: false, nfce_ambiente: "homologacao" }).eq("empresa_id", empresaId);
  await s.from("nfe_config").update({ ativa: false, autorizacao_texto: null, autorizado_em: null }).eq("empresa_id", empresaId);
  const { data: cupons } = await s.from("nfe_emissoes").select("id").eq("empresa_id", empresaId).eq("modelo", 65);
  const ids = (cupons ?? []).map((c) => c.id);
  if (ids.length) {
    await s.from("vendas").update({ nfe_emissao_id: null, documento_fiscal: null }).in("nfe_emissao_id", ids);
    await s.from("nfe_emissoes").delete().in("id", ids);
  }
  await s.from("vendas").update({ documento_fiscal: null }).eq("empresa_id", empresaId).eq("documento_fiscal", "nfce");
  await s.from("nfe_operacoes").delete().eq("empresa_id", empresaId).like("nome", `${PREFIXO}%`);
  await s.from("nfe_emitentes").update({ nfce_serie: null, nfce_proximo_numero_homologacao: 1, nfce_proximo_numero_producao: 1 }).eq("empresa_id", empresaId);
  await s.from("certificados_digitais").delete().eq("empresa_id", empresaId).eq("titular", TITULAR);
  await s.from("jobs").delete().eq("empresa_id", empresaId).eq("tipo", "emitir_nfe");
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, documento").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
  documento = data!.documento;
  await limpar();
  // Certificado FICTÍCIO e autorização do cliente registrada (sem rede, nada é enviado à SEFAZ)
  await servico!.from("certificados_digitais").insert({
    empresa_id: empresaId,
    titular: TITULAR,
    documento,
    impressao_digital: "C".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (E2E).",
  });
  await servico!.from("nfe_config").update({ autorizacao_texto: "Teste automático (E2E).", autorizado_em: new Date().toISOString() }).eq("empresa_id", empresaId);
});
test.afterAll(async () => {
  if (empresaId) await limpar();
});

test("escritório: operação do cupom, série, cupom ligado em teste e regra do cartão; o dono só vê a regra", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto/configuracao`);

  // Operação pelo modelo do balcão: "Serve para" vem marcado só no cupom
  await page.getByRole("button", { name: "Nova operação" }).click();
  const dlgOp = page.getByRole("dialog");
  await dlgOp.locator("#op-modelo").selectOption({ label: "Venda no balcão a consumidor final — cupom fiscal (NFC-e) (5102)" });
  const servePara = dlgOp.getByTestId("op-modelos");
  await expect(servePara.getByLabel("Cupom fiscal (NFC-e)")).toBeChecked();
  await expect(servePara.getByLabel("Nota fiscal (NF-e)")).not.toBeChecked();
  await expect(dlgOp.locator("#op-cfop")).toHaveValue("5102");
  await dlgOp.locator("#op-nome").fill(OPERACAO);
  await dlgOp.locator("#op-cst").selectOption("102");
  // Sem o CST do PIS/Cofins, o campo avisa (o escritório escolhe os impostos)
  await dlgOp.getByRole("button", { name: "Salvar operação" }).click();
  await expect(dlgOp.getByText("Escolha o CST do PIS.").first()).toBeVisible({ timeout: 30_000 });
  await dlgOp.locator("#op-pis").selectOption("49");
  await dlgOp.locator("#op-cofins").selectOption("49");
  await dlgOp.getByRole("button", { name: "Salvar operação" }).click();
  await expect(page.getByText("Operação salva.").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("listitem").filter({ hasText: OPERACAO })).toContainText("Cupom fiscal");
  const { data: op } = await servico!.from("nfe_operacoes").select("id, modelos, consumidor_final, destino").eq("empresa_id", empresaId).eq("nome", OPERACAO).single();
  expect(op).toMatchObject({ modelos: ["nfce"], consumidor_final: true, destino: "interna" });

  // Antes da série, o cupom não liga
  const cupom = page.locator("#form-cupom-fiscal");
  await expect(cupom.getByText("Informe a série do cupom em “Quem emite” antes de ligar.")).toBeVisible();

  // Série do cupom na inscrição que emite
  await page.getByRole("listitem").filter({ hasText: "Madeireira Reflorestar (DEMO)" }).getByRole("button", { name: "Editar" }).click();
  const dlgEm = page.getByRole("dialog");
  await dlgEm.locator("#em-nfce-serie").fill("1");
  await dlgEm.getByRole("button", { name: "Salvar inscrição" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Madeireira Reflorestar (DEMO)" })).toContainText("cupom série 1", { timeout: 30_000 });

  // Liga o cupom em teste (homologação)
  await cupom.getByLabel(/Cupom fiscal ligado/).check();
  await expect(cupom.locator("#nfce_ambiente")).toHaveValue("homologacao");
  await cupom.getByRole("button", { name: "Salvar cupom fiscal" }).click();
  await expect.poll(async () => (await servico!.from("nfe_config").select("nfce_ativa").eq("empresa_id", empresaId).single()).data?.nfce_ativa, { timeout: 30_000 }).toBe(true);

  // Loja: operação do cupom e a regra do cartão (só o escritório muda)
  await page.goto(`/e/${empresaId}/loja/configuracoes`);
  await page.locator("#nfce_operacao_id").selectOption(op!.id);
  const regra = page.getByTestId("regra-cartao");
  await regra.getByLabel("Exigir nota no cartão de crédito").check();
  await expect(regra.getByLabel("Exigir nota no cartão de débito")).not.toBeChecked();
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect
    .poll(async () => (await servico!.from("gestao_config").select("nota_obrigatoria_formas, nfce_operacao_id").eq("empresa_id", empresaId).single()).data, { timeout: 30_000 })
    .toEqual({ nota_obrigatoria_formas: ["cartao_credito"], nfce_operacao_id: op!.id });

  // O dono vê a regra ligada, mas travada
  const ctx = await browser.newContext();
  const dono = await ctx.newPage();
  try {
    await entrar(dono, `madeireira@${DOMINIO}`);
    await dono.goto(`/e/${empresaId}/loja/configuracoes`);
    const regraDono = dono.getByTestId("regra-cartao");
    await expect(regraDono).toContainText("Só o escritório liga ou desliga esta regra.");
    await expect(regraDono.getByLabel("Exigir nota no cartão de crédito")).toBeChecked();
    await expect(regraDono.getByLabel("Exigir nota no cartão de crédito")).toBeDisabled();
    // Salvar as configurações da loja pelo dono não desliga a regra
    await dono.getByRole("button", { name: "Salvar configurações" }).click();
    await expect(dono.getByText(/Configurações salvas|salvas/).first()).toBeVisible({ timeout: 30_000 });
    const { data: g } = await servico!.from("gestao_config").select("nota_obrigatoria_formas").eq("empresa_id", empresaId).single();
    expect(g!.nota_obrigatoria_formas).toEqual(["cartao_credito"]);
  } finally {
    await ctx.close();
  }
});

test("caixa: no cartão de crédito a venda sai com cupom fiscal; no PIX a nota é opcional (sem rede: nada vai à SEFAZ)", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(process.env.NOTAS_AUTOMATICAS_SEM_REDE !== "1", "Só roda com as consultas fiscais desligadas neste ambiente.");
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/vender`);
  const abrir = page.getByRole("button", { name: "Abrir o caixa" });
  if (await abrir.isVisible().catch(() => false)) {
    await page.getByLabel("Nome do caixa").fill("Caixa 1");
    await page.getByLabel("Troco inicial na gaveta").fill("100,00");
    await abrir.click();
  }
  await expect(page.getByLabel("Buscar produto")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Buscar produto").fill("mourão");
  await page.getByRole("button", { name: /Mourão de eucalipto/ }).click();

  const caixinha = page.getByLabel("Emitir nota fiscal ao concluir a venda");
  const formas = page.getByRole("group", { name: "Formas de pagamento" });

  // PIX: a nota continua opcional
  await formas.getByRole("button", { name: /PIX/ }).click();
  await expect(caixinha).toBeEnabled();
  await expect(caixinha).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Concluir venda", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tirar PIX" }).click();

  // Cartão de crédito: a nota é obrigatória e, sem NF-e ligada, sai o cupom
  await formas.getByRole("button", { name: /Cartão de crédito/ }).click();
  await expect(caixinha).toBeChecked();
  await expect(caixinha).toBeDisabled();
  await expect(page.getByText("Pagamento no cartão: nesta loja a venda sai com nota fiscal (regra do escritório).")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Cupom fiscal (NFC-e)" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Nota fiscal (NF-e)" })).toBeDisabled();
  await page.getByRole("button", { name: "Concluir venda e emitir cupom" }).click();

  const concluida = page.getByRole("dialog");
  await expect(concluida).toContainText("concluída", { timeout: 60_000 });
  const venda = (await concluida.getByRole("link", { name: "Ver a venda" }).getAttribute("href"))!.split("/").pop()!;
  await expect(concluida.getByTestId("nota-da-venda")).toContainText("Cupom fiscal");

  // O cupom ficou ligado à venda: modelo 65, série 1, ambiente de teste
  const { data: v } = await servico!.from("vendas").select("documento_fiscal, nfe_emissao_id").eq("id", venda).single();
  expect(v!.documento_fiscal).toBe("nfce");
  expect(v!.nfe_emissao_id).toBeTruthy();
  const { data: n } = await servico!.from("nfe_emissoes").select("modelo, serie, numero, ambiente").eq("id", v!.nfe_emissao_id!).single();
  expect(n).toMatchObject({ modelo: 65, serie: 1, numero: 1, ambiente: "homologacao" });

  // Sem rede, a SEFAZ nunca responde: a situação é a real (nada é fingido)
  await expect(concluida.getByText(/Sem resposta|Emitindo|Enviando à SEFAZ|Rejeitada|pendente/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(concluida.getByText("Autorizada")).toHaveCount(0);

  // Na tela da venda, a nota aparece com a situação real e o cupom não imprime antes da autorização
  await page.goto(`/e/${empresaId}/loja/vendas/${venda}`);
  await expect(page.getByTestId("nota-da-venda")).toContainText("Cupom fiscal (NFC-e)");
  await expect(page.getByTestId("nota-da-venda").getByText("Imprimir cupom")).toHaveCount(0);
  await page.goto(`/impressao/cupom/${venda}`);
  await expect(page.getByText("Cupom fiscal ainda não autorizado")).toBeVisible();
});
