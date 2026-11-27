import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chaveNfe, cnpjComDv, danfeFicticio, formatarCnpjTeste, xmlCompraFicticio } from "../apoio/notas-ficticias";

/**
 * Entrada de mercadorias importando a nota (dados fictícios, Madeireira Reflorestar):
 *  - XML: o dono escolhe o arquivo e o portal lança os três itens de uma vez —
 *    um no produto com o mesmo código de barras e dois produtos novos, com o
 *    preço de venda = custo + margem; o XML fica nos documentos da empresa;
 *    importar o mesmo XML de novo não lança outra vez;
 *  - PDF (DANFE de outro sistema) do mesmo fornecedor: o item já ligado pela
 *    nota anterior vai para o mesmo produto e o novo é cadastrado; a nota fica
 *    registrada pela chave e o mesmo PDF não entra duas vezes;
 *  - PDF de nota de outra empresa é recusado sem gravar nada;
 *  - o balconista (só vende) não vê a importação.
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

/** EAN-13 com o dígito verificador. */
function eanComDv(base12: string) {
  const soma = base12.split("").reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return base12 + String((10 - (soma % 10)) % 10);
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

const sufixo = String(randomInt(100000, 999999));
const FORNECEDOR = cnpjComDv(`88${sufixo}0001`);
const NOME_FORNECEDOR = `FORNECEDOR E2E ${sufixo} (FICTICIO)`;
const NUMERO = Number(sufixo);
const GTIN = eanComDv(`789${sufixo}001`);
let empresaId = "";
let cnpjEmpresa = "";
let lixaId = "";

async function produto(descricao: string) {
  const { data } = await servico!
    .from("nfe_produtos")
    .select("id, estoque_atual, preco_custo, valor_unitario, unidade")
    .eq("empresa_id", empresaId)
    .eq("descricao", descricao)
    .maybeSingle();
  return data;
}

async function enviar(page: Page, arquivo: { name: string; mimeType: string; buffer: Buffer }) {
  await page.locator('input[type="file"]').setInputFiles(arquivo);
  await page.getByLabel("Margem dos produtos novos").fill("50");
  await page.getByRole("button", { name: "Ler e lançar no estoque" }).click();
}

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id, documento").eq("razao_social", MADEIREIRA).single();
  empresaId = emp!.id;
  cnpjEmpresa = emp!.documento.replace(/\D/g, "");
  // Produto que já existe na loja, com o código de barras do primeiro item da nota
  const { data: lixa, error } = await servico!
    .from("nfe_produtos")
    .insert({ empresa_id: empresaId, codigo: `E2E-LX-${sufixo}`, descricao: `Lixa teste E2E ${sufixo}`, ncm: "68052000", unidade: "CX", valor_unitario: 9, gtin: GTIN })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  lixaId = lixa!.id;
});

test("XML: lança todos os itens (código de barras e produtos novos) e não lança duas vezes", async ({ page }) => {
  test.setTimeout(180_000);
  // Com a entrada automática ligada (a importação tem de valer igual)
  await servico!.from("gestao_config").update({ entrada_automatica: true }).eq("empresa_id", empresaId);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/produtos`);
  await page.getByRole("link", { name: "Entrada de mercadorias" }).click();
  await expect(page.getByRole("heading", { name: "Entrada de mercadorias" })).toBeVisible();
  await expect(page.getByText("Importar nota de compra (XML ou PDF)")).toBeVisible();

  const xml = xmlCompraFicticio({
    chave: chaveNfe({ cnpjEmitente: FORNECEDOR, numero: NUMERO, aamm: "2610" }),
    numero: NUMERO,
    emitenteCnpj: FORNECEDOR,
    emitenteNome: NOME_FORNECEDOR,
    destinatarioCnpj: cnpjEmpresa,
    itens: [
      { codigo: `LX-${sufixo}`, ean: GTIN, descricao: `LIXA MADEIRA 80 E2E ${sufixo}`, ncm: "68052000" },
      { codigo: `CL-${sufixo}`, ean: "SEM GTIN", descricao: `COLA PVA 1KG E2E ${sufixo}`, ncm: "35069190" },
      { codigo: `PF-${sufixo}`, ean: "SEM GTIN", descricao: `PARAFUSO 4X40 E2E ${sufixo}`, ncm: "73181500" },
    ],
  });
  const arquivo = { name: `nota-${sufixo}.xml`, mimeType: "application/xml", buffer: Buffer.from(xml, "utf8") };
  await enviar(page, arquivo);
  await expect(page.getByText(`Nota ${NUMERO} de ${NOME_FORNECEDOR}: 3 item(ns) lançado(s) no estoque, 2 produto(s) novo(s) cadastrado(s).`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Código de barras", { exact: true })).toBeVisible();
  await expect(page.getByText("Produto novo", { exact: true })).toHaveCount(2);

  // Estoque e produtos novos com preço = custo + 50%
  const lixa = await produto(`Lixa teste E2E ${sufixo}`);
  expect([Number(lixa!.estoque_atual), Number(lixa!.preco_custo)]).toEqual([100, 5]);
  const cola = await produto(`COLA PVA 1KG E2E ${sufixo}`);
  expect([Number(cola!.estoque_atual), Number(cola!.preco_custo), Number(cola!.valor_unitario), cola!.unidade]).toEqual([50, 8, 12, "UN"]);
  const parafuso = await produto(`PARAFUSO 4X40 E2E ${sufixo}`);
  expect([Number(parafuso!.estoque_atual), Number(parafuso!.valor_unitario)]).toEqual([20, 7.5]);
  // O XML ficou nos documentos da empresa (o escritório recebe) e os itens ficaram ligados ao fornecedor
  const { data: doc } = await servico!.from("documentos").select("origem, enviado_por").eq("empresa_id", empresaId).eq("nome_original", `nota-${sufixo}.xml`).single();
  expect(doc!.origem).toBe("upload");
  expect(doc!.enviado_por).not.toBeNull();
  const { count: vinculos } = await servico!.from("estoque_vinculos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("fornecedor_documento", FORNECEDOR);
  expect(vinculos).toBe(3);
  // A importação já lançou a nota: a entrada automática não manda aviso de "nota esperando conferência"
  const { count: avisos } = await servico!
    .from("notificacoes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("tipo", "estoque_entrada")
    .ilike("corpo", `%nota ${NUMERO} de%`);
  expect(avisos).toBe(0);

  // A mesma nota de novo: nada é lançado outra vez
  await enviar(page, arquivo);
  await expect(page.getByText(`Nota ${NUMERO} de ${NOME_FORNECEDOR} já tinha dado entrada no estoque. Nada foi lançado de novo.`)).toBeVisible({ timeout: 60_000 });
  expect(Number((await produto(`Lixa teste E2E ${sufixo}`))!.estoque_atual)).toBe(100);
});

test("PDF: lê o DANFE, usa o item já ligado, cadastra o novo e não lança duas vezes", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota`);
  const chave = chaveNfe({ cnpjEmitente: FORNECEDOR, numero: NUMERO + 1, aamm: "2610" });
  const pdf = await danfeFicticio({
    chave,
    destinatario: formatarCnpjTeste(cnpjEmpresa),
    emitenteNome: NOME_FORNECEDOR,
    totalProdutos: "126,00",
    itens: [
      { cod: `CL-${sufixo}`, desc: `COLA PVA 1KG E2E ${sufixo}`, ncm: "35069190", cst: "0102", cfop: "5102", un: "UN", qtd: "10,0000", vun: "8,2000", vtot: "82,00", vdesc: "0,00" },
      { cod: `TR-${sufixo}`, desc: `TRINCHA 2 POL E2E ${sufixo}`, ncm: "96034010", cst: "0102", cfop: "5102", un: "UN", qtd: "4,0000", vun: "11,0000", vtot: "44,00", vdesc: "0,00" },
    ],
  });
  const arquivo = { name: `danfe-${sufixo}.pdf`, mimeType: "application/pdf", buffer: pdf };
  await enviar(page, arquivo);
  await expect(page.getByText(`Nota ${NUMERO + 1} de ${NOME_FORNECEDOR}: 2 item(ns) lançado(s) no estoque, 1 produto(s) novo(s) cadastrado(s).`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Já ligado", { exact: true })).toBeVisible();

  const cola = await produto(`COLA PVA 1KG E2E ${sufixo}`);
  expect(Number(cola!.estoque_atual)).toBe(60);
  const trincha = await produto(`TRINCHA 2 POL E2E ${sufixo}`);
  expect([Number(trincha!.estoque_atual), Number(trincha!.valor_unitario)]).toEqual([4, 16.5]);
  const { data: registro } = await servico!.from("estoque_notas_pdf").select("numero, emitente_documento").eq("empresa_id", empresaId).eq("chave", chave).single();
  expect(registro).toEqual({ numero: String(NUMERO + 1), emitente_documento: FORNECEDOR });

  // Aparece em "Notas lançadas pelo PDF"; o mesmo PDF não entra de novo
  await page.reload();
  await expect(page.getByText(`Nota ${NUMERO + 1}`, { exact: true })).toBeVisible();
  await enviar(page, arquivo);
  await expect(page.getByText(`Nota ${NUMERO + 1} de ${NOME_FORNECEDOR} já tinha dado entrada no estoque. Nada foi lançado de novo.`)).toBeVisible({ timeout: 60_000 });
  expect(Number((await produto(`COLA PVA 1KG E2E ${sufixo}`))!.estoque_atual)).toBe(60);
});

test("PDF de nota de outra empresa é recusado sem gravar nada", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota`);
  const chave = chaveNfe({ cnpjEmitente: FORNECEDOR, numero: NUMERO + 2, aamm: "2610" });
  const pdf = await danfeFicticio({
    chave,
    destinatario: "11.222.333/0001-81",
    totalProdutos: "10,00",
    itens: [{ cod: "X-1", desc: `ITEM DE OUTRA EMPRESA ${sufixo}`, ncm: "73181500", cst: "0102", cfop: "5102", un: "UN", qtd: "1", vun: "10,00", vtot: "10,00", vdesc: "0,00" }],
  });
  await enviar(page, { name: `outra-${sufixo}.pdf`, mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText("O CNPJ desta empresa não aparece no PDF: a nota parece ser de outra empresa. Confira o arquivo.")).toBeVisible({ timeout: 60_000 });
  const { count } = await servico!.from("estoque_notas_pdf").select("id", { count: "exact", head: true }).eq("chave", chave);
  expect(count).toBe(0);
  expect(await produto(`ITEM DE OUTRA EMPRESA ${sufixo}`)).toBeNull();
});

test("balconista (só vende) não vê a importação da nota", async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/produtos`);
  await expect(page.getByRole("link", { name: "Entrada de mercadorias" })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/loja/produtos/entrada-nota`);
  await expect(page.getByRole("button", { name: "Ler e lançar no estoque" })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test.afterAll(async () => {
  // O produto de apoio fica desativado (os movimentos de estoque continuam no histórico)
  if (lixaId) await servico!.from("nfe_produtos").update({ ativo: false }).eq("id", lixaId);
});
