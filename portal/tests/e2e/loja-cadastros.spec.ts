import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Clientes e fornecedores na loja (dados fictícios da Madeireira de demonstração):
 *  - o dono cadastra cliente com endereço (vira destinatário da NF-e) e fornecedor
 *    com contato e prazo, e abre as fichas;
 *  - o balconista vê os clientes e cadastra cliente novo, mas não vê fornecedores
 *    nem altera cadastros;
 *  - o cliente de outra empresa não abre os cadastros da madeireira.
 * No fim, os cadastros criados pelo teste são apagados.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";

function carregarEnv() {
  if (existsSync(".env.local")) {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
carregarEnv();
const URL_SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const servico: SupabaseClient | null =
  URL_SUPA && process.env.SUPABASE_SECRET_KEY ? createClient(URL_SUPA, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }) : null;

function cpfValido(base9: string) {
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9);
  return `${base9}${d1}${calc(base9 + d1)}`;
}
function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

const sufixo = String(randomInt(100000, 999999));
const CPF = cpfValido(`8${sufixo}12`.slice(0, 9));
const CNPJ = cnpjValido(`77${sufixo}0001`.slice(0, 12));
const CLIENTE = `Cliente E2E ${sufixo} (FICTÍCIO)`;
const FORNECEDOR = `Fornecedor E2E ${sufixo} (FICTÍCIO)`;
const BALCAO = `Cliente do balcão E2E ${sufixo}`;
const CPF_IMP = cpfValido(`7${sufixo}34`.slice(0, 9));
const IMPORTADO = `Importado E2E ${sufixo}`;
const SEM_CPF = `Sem CPF E2E ${sufixo}`;
let empresaId = "";
let telefoneConstrutora: string | null | undefined;
let observacaoConstrutora: string | null = null;

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
});

test.afterAll(async () => {
  if (!empresaId) return;
  await servico!.from("nfe_destinatarios").delete().eq("empresa_id", empresaId).in("documento", [CPF, CNPJ]);
  await servico!.from("nfe_destinatarios").delete().eq("empresa_id", empresaId).eq("documento", CPF_IMP);
  await servico!.from("contrapartes").delete().eq("empresa_id", empresaId).or(`documento.in.(${CPF},${CNPJ},${CPF_IMP}),nome.eq.${BALCAO}`);
  await servico!.from("contrapartes").delete().eq("empresa_id", empresaId).in("nome", [IMPORTADO, SEM_CPF]);
  if (telefoneConstrutora !== undefined) {
    await servico!.from("contrapartes").update({ observacoes: observacaoConstrutora }).eq("empresa_id", empresaId).eq("documento", "55666777000181");
  }
});

test("dono: cadastra cliente com endereço e fornecedor com contato e prazo", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/clientes`);
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("linha-cadastro").filter({ hasText: "CONSTRUTORA HORIZONTE" })).toHaveCount(1);

  // Cliente novo com endereço completo
  await page.getByRole("button", { name: "Novo cliente" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("CPF ou CNPJ").fill(CPF);
  await d.getByLabel("Nome do cliente").fill(CLIENTE);
  await d.getByLabel("Telefone / WhatsApp").fill("(63) 98888-1234");
  await d.getByLabel("CEP").fill("77001-000");
  await d.getByLabel("Rua / avenida").fill("Rua das Árvores (fictícia)");
  await d.getByLabel("Número").fill("123");
  await d.getByLabel("Bairro").fill("Centro");
  await d.getByLabel("Estado (UF)").selectOption("TO");
  await expect(d.getByLabel("Município").locator("option", { hasText: "Palmas" })).toHaveCount(1, { timeout: 30_000 });
  await d.getByLabel("Município").selectOption({ label: "Palmas" });
  await d.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  const linha = page.getByTestId("linha-cadastro").filter({ hasText: CLIENTE });
  await expect(linha).toContainText("Palmas / TO");
  // Virou destinatário da NF-e com o endereço
  const { data: dest } = await servico!.from("nfe_destinatarios").select("logradouro, municipio_ibge").eq("empresa_id", empresaId).eq("documento", CPF).single();
  expect(dest).toEqual({ logradouro: "Rua das Árvores (fictícia)", municipio_ibge: "1721000" });

  // Ficha do cliente
  await linha.getByRole("link", { name: CLIENTE, exact: true }).click();
  await expect(page.getByRole("heading", { name: CLIENTE, level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Total comprado")).toBeVisible();
  await expect(page.getByText(/Rua das Árvores \(fictícia\), 123/)).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /wa\.me\/5563988881234/);

  // CPF repetido em outro cadastro é recusado
  await page.goto(`/e/${empresaId}/loja/clientes`);
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await page.getByRole("dialog").getByLabel("CPF ou CNPJ").fill("123.456.789-00");
  await page.getByRole("dialog").getByLabel("Nome do cliente").fill("CPF errado");
  await page.getByRole("dialog").getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByRole("dialog").getByText("CPF ou CNPJ inválido. Confira os números.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Fornecedor com contato e prazo
  await page.goto(`/e/${empresaId}/loja/fornecedores`);
  await expect(page.getByRole("heading", { name: "Fornecedores", level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Novo fornecedor" }).click();
  const f = page.getByRole("dialog");
  await f.getByLabel("CPF ou CNPJ").fill(CNPJ);
  await f.getByLabel("Nome do fornecedor").fill(FORNECEDOR);
  await f.getByLabel("Vendedor / contato").fill("Ana (vendas)");
  await f.getByLabel("Prazo de pagamento (dias)").fill("28");
  await f.getByRole("button", { name: "Cadastrar fornecedor" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId("linha-cadastro").filter({ hasText: FORNECEDOR }).getByRole("link", { name: FORNECEDOR, exact: true }).click();
  await expect(page.getByText("28 dias")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ana (vendas)")).toBeVisible();
  await expect(page.getByText("Notas de compra", { exact: true }).first()).toBeVisible();

  // Fornecedores das notas de compra já recebidas
  await page.goto(`/e/${empresaId}/loja/fornecedores`);
  await page.getByRole("button", { name: "Trazer das notas de compra" }).click();
  await expect(page.getByText(/fornecedor|Nenhum fornecedor novo/).first()).toBeVisible({ timeout: 30_000 });
});

test("dono: importa a planilha de clientes do GestãoClick (prévia, coluna corrigida e só completa o vazio)", async ({ page }) => {
  test.setTimeout(240_000);
  const { data: cons } = await servico!.from("contrapartes").select("telefone, observacoes").eq("empresa_id", empresaId).eq("documento", "55666777000181").single();
  telefoneConstrutora = cons!.telefone;
  observacaoConstrutora = cons!.observacoes;
  const csv = [
    "Código;Nome;Nome fantasia;CPF/CNPJ;Telefone;Celular;E-mail;Endereço;Bairro;Cidade;Estado;Anotação interna",
    `1;${IMPORTADO};;${CPF_IMP};;(63) 98123-4567;importado@exemplo.test;Rua da Planilha, 77;Centro;Palmas;TO;Cliente antigo`,
    `2;CONSTRUTORA HORIZONTE EXEMPLO LTDA (DEMO);Horizonte;55.666.777/0001-81;6330000000;;;;;;;Veio do GestãoClick`,
    `3;${SEM_CPF};;123.456.789-00;3215-1111;;;;;Palmas;TO;`,
    `4;${IMPORTADO};;${CPF_IMP};;;;;;;;`,
  ].join("\n");
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/clientes`);
  await page.getByRole("link", { name: "Importar planilha" }).click();
  await expect(page.getByRole("heading", { name: "Importar clientes", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Baixar modelo (Excel)" })).toHaveAttribute("href", /papel=cliente/);
  await page.getByLabel("Planilha").setInputFiles({ name: "clientes-gestaoclick.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByLabel("DDD padrão").fill("63");
  await page.getByRole("button", { name: "Conferir planilha" }).click();
  const totais = page.getByTestId("totais-importacao");
  await expect(totais).toContainText("Novos", { timeout: 60_000 });
  await expect(totais.getByText("2", { exact: true })).toHaveCount(1); // 2 novos
  // "Anotação interna" não foi reconhecida: vira Observações
  await page.getByLabel("O que é a coluna Anotação interna").selectOption("observacoes");
  await expect(page.getByTestId("linha-previa").filter({ hasText: "CPF/CNPJ inválido" })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("linha-previa").filter({ hasText: "Mesmo CPF/CNPJ de uma linha acima" })).toHaveCount(1);
  await expect(page.getByTestId("linha-previa").filter({ hasText: "Já cadastrado como" })).toHaveCount(1);
  await page.getByRole("button", { name: "Importar 3 cadastros" }).click();
  await expect(page.getByText(/Importação concluída: 2 cadastro\(s\) novo\(s\) e 1 completado\(s\)/)).toBeVisible({ timeout: 60_000 });

  const { data: imp } = await servico!.from("contrapartes").select("telefone, email, logradouro, numero, municipio_ibge, observacoes, papeis").eq("empresa_id", empresaId).eq("documento", CPF_IMP).single();
  expect(imp).toEqual({ telefone: "63981234567", email: "importado@exemplo.test", logradouro: "Rua da Planilha", numero: "77", municipio_ibge: "1721000", observacoes: "Cliente antigo", papeis: ["cliente"] });
  const { data: sem } = await servico!.from("contrapartes").select("documento, telefone").eq("empresa_id", empresaId).eq("nome", SEM_CPF).single();
  expect(sem).toEqual({ documento: null, telefone: "6332151111" });
  const { data: cons2 } = await servico!.from("contrapartes").select("telefone").eq("empresa_id", empresaId).eq("documento", "55666777000181").single();
  expect(cons2!.telefone).toBe(telefoneConstrutora); // o que já estava preenchido não muda
  await page.getByRole("link", { name: "Ver clientes" }).click();
  await expect(page.getByTestId("linha-cadastro").filter({ hasText: IMPORTADO })).toHaveCount(1, { timeout: 30_000 });
});

test("balconista: vê e cadastra clientes, sem fornecedores nem alterar cadastros", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/clientes`);
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("linha-cadastro").filter({ hasText: CLIENTE })).toHaveCount(1);
  await expect(page.getByRole("button", { name: `Editar ${CLIENTE}` })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fornecedores" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Importar planilha" })).toHaveCount(0);
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await page.getByRole("dialog").getByLabel("Nome do cliente").fill(BALCAO);
  await page.getByRole("dialog").getByLabel("Telefone / WhatsApp").fill("63977771234");
  await page.getByRole("dialog").getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("linha-cadastro").filter({ hasText: BALCAO })).toHaveCount(1);
  // Fornecedores: página não abre
  const r = await page.goto(`/e/${empresaId}/loja/fornecedores`);
  expect(r?.status()).toBe(404);
});

test("cliente de outra empresa não abre os cadastros da madeireira", async ({ page }) => {
  test.setTimeout(180_000);
  await entrar(page, `cliente@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/clientes`);
  await expect(page.getByText(CLIENTE)).toHaveCount(0);
  await expect(page.getByText(/Página não encontrada|não tem permissão/).first()).toBeVisible({ timeout: 60_000 });
});
