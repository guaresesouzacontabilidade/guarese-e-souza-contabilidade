import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Orçamento avulso no balcão (dados fictícios da Madeireira Reflorestar):
 *  - o balconista faz o orçamento sem abrir o caixa, para cliente sem
 *    cadastro, com nome, CPF e telefone (CPF errado é recusado);
 *  - o papel impresso traz o CPF e o telefone;
 *  - o botão do WhatsApp abre a conversa do cliente com a mensagem e o link;
 *  - o link abre sem login e mostra itens e total, sem CPF, telefone nem
 *    sobrenome; editar mantém o mesmo link; cancelado, o link deixa de abrir.
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

let empresaId = "";
test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
});

test("balcão: orçamento avulso sem caixa, impressão com CPF, WhatsApp e link do cliente", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/orcamento`);
  await expect(page.getByRole("heading", { name: "Novo orçamento" })).toBeVisible({ timeout: 30_000 });
  // Sem caixa e sem pagamento
  await expect(page.getByRole("group", { name: "Formas de pagamento" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Concluir venda" })).toHaveCount(0);

  await page.getByLabel("Buscar produto").fill("mourão");
  await page.getByRole("button", { name: /Mourão de eucalipto/ }).click();
  await page.locator('input[id^="q-"]').first().fill("10");
  await page.getByLabel("Nome do cliente (sem cadastro)").fill("João Orçamento Teste");
  await page.getByLabel("CPF ou CNPJ do cliente (opcional)").fill("111.111.111-11");
  await page.getByLabel("Telefone ou WhatsApp do cliente (opcional)").fill("63999991234");
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await expect(page.getByText("CPF ou CNPJ do cliente inválido")).toBeVisible();

  await page.getByLabel("CPF ou CNPJ do cliente (opcional)").fill("52998224725");
  await page.getByLabel("CPF ou CNPJ do cliente (opcional)").blur();
  await expect(page.getByLabel("CPF ou CNPJ do cliente (opcional)")).toHaveValue("529.982.247-25");
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await page.waitForURL(/\/loja\/vendas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /Orçamento nº \d+/ })).toBeVisible();
  const orcamentoId = page.url().split("/").pop()!;

  // WhatsApp: conversa do cliente com a mensagem e o link
  const href = (await page.getByTestId("whatsapp-orcamento").getAttribute("href"))!;
  expect(href.startsWith("https://wa.me/5563999991234?text=")).toBe(true);
  const texto = decodeURIComponent(href.split("?text=")[1]);
  expect(texto).toContain("Olá, João!");
  expect(texto).toContain("Total: R$");
  const link = /https?:\/\/\S+\/orcamento\/([a-z0-9]{16})/.exec(texto);
  expect(link).not.toBeNull();
  const codigo = link![1];

  // Papel do orçamento com CPF e telefone
  await page.goto(`/impressao/venda/${orcamentoId}`);
  await expect(page.getByText(/ORÇAMENTO Nº \d+/)).toBeVisible();
  await expect(page.getByText("CPF/CNPJ: 529.982.247-25")).toBeVisible();
  await expect(page.getByText(/Telefone: \(63\) 99999-?1234/)).toBeVisible();

  // Link do cliente, sem login
  const visitante = await browser.newContext();
  const pv = await visitante.newPage();
  await pv.goto(`/orcamento/${codigo}`);
  await expect(pv.getByText(/Orçamento nº \d+/)).toBeVisible({ timeout: 30_000 });
  await expect(pv.getByText(/Olá, João!/)).toBeVisible();
  await expect(pv.getByRole("list", { name: "Itens do orçamento" })).toContainText("Mourão de eucalipto");
  await expect(pv.getByTestId("total-orcamento")).toHaveText("R$ 280,00");
  const corpo = await pv.locator("main").innerText();
  expect(corpo).not.toMatch(/529\.982|52998224725|99999-?1234|999991234|Orçamento Teste/);

  // Editar mantém o mesmo link
  await page.goto(`/e/${empresaId}/loja/vendas/${orcamentoId}`);
  await page.getByRole("link", { name: "Editar" }).click();
  await expect(page.getByRole("heading", { name: /Editar o orçamento nº \d+/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("CPF ou CNPJ do cliente (opcional)")).toHaveValue("529.982.247-25");
  await page.locator('input[id^="q-"]').first().fill("12");
  await page.getByRole("button", { name: "Salvar orçamento" }).click();
  await page.waitForURL(new RegExp(`/loja/vendas/${orcamentoId}$`), { timeout: 60_000 });
  const href2 = (await page.getByTestId("whatsapp-orcamento").getAttribute("href"))!;
  expect(decodeURIComponent(href2)).toContain(`/orcamento/${codigo}`);
  await pv.reload();
  await expect(pv.getByTestId("total-orcamento")).toHaveText("R$ 336,00");

  // Cancelado, o link deixa de abrir
  await servico!.from("vendas").update({ status: "cancelada", cancelada_em: new Date().toISOString(), motivo_cancelamento: "Teste automático" }).eq("id", orcamentoId);
  const resposta = await pv.goto(`/orcamento/${codigo}`);
  expect(resposta?.status()).toBe(404);
  await visitante.close();
});
