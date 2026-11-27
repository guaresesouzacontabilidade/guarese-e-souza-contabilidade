import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Gestão na modalidade "notas e transporte" (dados fictícios da demonstração,
 * Grãos Cerrado — comercial de soja e milho de MT):
 *  - o menu mostra as ordens de carregamento e não mostra caixa nem vendas;
 *  - a balança cria a ordem com a transportadora do cadastro (placa e RNTRC
 *    vêm junto), imprime o PDF e registra a pesagem (líquido em sacas);
 *  - com a NF-e desligada, a ordem avisa e não oferece a emissão;
 *  - a NF-e sai da ordem com o peso da balança, o comprador e o transporte, e
 *    a ordem fica faturada (sem rede: nada vai à SEFAZ);
 *  - cliente de outra empresa não vê as ordens nem o PDF.
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
const criadas: string[] = [];

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", GRAOS).single();
  empresaId = data!.id;
});

test.afterAll(async () => {
  // Remove só as ordens criadas pelos testes (a demonstração fica como estava)
  if (criadas.length) await servico!.from("ordens_carregamento").delete().in("id", criadas);
});

test("balança: menu sem caixa, nova ordem com a transportadora do cadastro, PDF e pesagem em sacas", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balanca@${DOMINIO}`);

  // A gestão desta empresa é só de notas e transporte: o painel da loja leva às ordens
  await page.goto(`/e/${empresaId}/loja`);
  await page.waitForURL(/\/loja\/carregamentos$/);
  await expect(page.getByRole("link", { name: "Ordens de carregamento" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Vender", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Caixa do dia" })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/loja/vender`);
  await expect(page.getByText("Esta empresa usa a gestão de notas e transporte")).toBeVisible();

  // Nova ordem: a placa e o RNTRC vêm da transportadora escolhida
  await page.goto(`/e/${empresaId}/loja/carregamentos/nova`);
  await page.getByLabel("Produto").selectOption({ label: "SOJA EM GRAOS (SC de 60 kg)" });
  await page.getByLabel(/^Quantidade/).fill("500");
  await expect(page.getByText("Em branco: 30.000 kg.")).toBeVisible();
  await escolher(page, "Comprador", "TRADING EXEMPLO");
  await escolher(page, "Transportadora", "TRANSPORTES EXEMPLO");
  await expect(page.getByLabel("Placa do caminhão (cavalo)")).toHaveValue("QBA1C23");
  await expect(page.getByLabel("RNTRC (ANTT)")).toHaveValue("012345678");
  await page.getByLabel("Motorista", { exact: true }).fill("MOTORISTA DO TESTE (E2E)");
  await page.getByLabel("CPF do motorista").fill("529.982.247-25");
  await page.getByLabel("Placa da carreta 1").fill("qba-2d34");
  await page.getByRole("button", { name: "Criar ordem de carregamento" }).click();
  await page.waitForURL(/\/loja\/carregamentos\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const ordemId = page.url().split("/").pop()!;
  criadas.push(ordemId);
  await expect(page.getByRole("heading", { name: /Ordem de carregamento nº \d+/ })).toBeVisible();
  await expect(page.getByText("Aguardando carregar", { exact: true })).toBeVisible();

  const { data: o } = await servico!.from("ordens_carregamento").select("placa, placa_uf, placas_reboque, rntrc, peso_previsto_kg, motorista_cpf, status").eq("id", ordemId).single();
  expect(o).toMatchObject({ placa: "QBA1C23", placa_uf: "MT", placas_reboque: ["QBA2D34"], rntrc: "012345678", motorista_cpf: "52998224725", status: "aberta" });
  expect(Number(o!.peso_previsto_kg)).toBe(30000);

  // Sem certificado e autorização, a NF-e fica desligada: a tela avisa e não oferece a emissão
  await expect(page.getByText("Emissão de NF-e desligada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Emitir NF-e" })).toHaveCount(0);

  // PDF da ordem para o motorista e a balança
  const pdf = await page.request.get(`/api/loja/carregamentos/${ordemId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  // Pesagem: 45.020 − 15.000 = 30.020 kg = 500,3333 sacas
  await page.getByLabel("Peso bruto (kg)").fill("45.020");
  await page.getByLabel("Tara (kg)").fill("15.000");
  await expect(page.getByText(/Peso líquido: 30\.020 kg = 500,3333 SC/)).toBeVisible();
  await page.getByLabel("Umidade (%)").fill("13,5");
  await page.getByLabel("Ticket da balança").fill("E2E-1");
  await page.getByRole("button", { name: "Registrar a pesagem" }).click();
  await expect(page.getByText("Carregada (falta a NF-e)", { exact: true })).toBeVisible({ timeout: 30_000 });
  const { data: p } = await servico!.from("ordens_carregamento").select("status, peso_liquido_kg, umidade, ticket_balanca").eq("id", ordemId).single();
  expect(p).toMatchObject({ status: "carregada", ticket_balanca: "E2E-1" });
  expect(Number(p!.peso_liquido_kg)).toBe(30020);
  expect(Number(p!.umidade)).toBe(13.5);
});

test("NF-e a partir da ordem: peso da balança em sacas, comprador e transporte; a ordem fica faturada (sem rede: nada vai à SEFAZ)", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(process.env.NOTAS_AUTOMATICAS_SEM_REDE !== "1", "Só roda com as consultas fiscais desligadas neste ambiente.");
  const { data: emp } = await servico!.from("empresas").select("documento").eq("id", empresaId).single();
  const { data: ordem } = await servico!.from("ordens_carregamento").select("id, numero, status, nfe_emissao_id").eq("empresa_id", empresaId).eq("numero", 1).single();
  expect(ordem!.status).toBe("carregada");
  const limpar = async () => {
    const { data: atual } = await servico!.from("ordens_carregamento").select("nfe_emissao_id").eq("id", ordem!.id).single();
    await servico!.from("ordens_carregamento").update({ status: "carregada", nfe_emissao_id: null }).eq("id", ordem!.id);
    if (atual?.nfe_emissao_id) await servico!.from("nfe_emissoes").delete().eq("id", atual.nfe_emissao_id);
    await servico!.from("nfe_config").update({ ativa: false, autorizacao_texto: null, autorizado_em: null }).eq("empresa_id", empresaId);
    await servico!.from("certificados_digitais").delete().eq("empresa_id", empresaId).eq("titular", "CERTIFICADO FICTICIO (E2E)");
    await servico!.from("jobs").delete().eq("empresa_id", empresaId).eq("tipo", "emitir_nfe");
  };
  await limpar();
  // Emissão ligada só neste teste, com um certificado FICTÍCIO (sem rede, nada é enviado à SEFAZ)
  await servico!.from("certificados_digitais").insert({
    empresa_id: empresaId,
    titular: "CERTIFICADO FICTICIO (E2E)",
    documento: emp!.documento,
    impressao_digital: "F".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (E2E).",
  });
  await servico!.from("nfe_config").update({ ativa: true, autorizacao_texto: "Teste automático (E2E).", autorizado_em: new Date().toISOString() }).eq("empresa_id", empresaId);
  try {
    await entrar(page, `graos@${DOMINIO}`);
    await page.goto(`/e/${empresaId}/loja/carregamentos/${ordem!.id}`);
    await page.getByRole("link", { name: "Emitir NF-e" }).click();
    await page.waitForURL(/notas-produto\/nova\?ordem=/);
    await expect(page.getByText(`Comprador, produto, peso e transporte vieram da ordem nº ${ordem!.numero}`)).toBeVisible();
    // 36.020 kg ÷ 60 kg = 600,3333 sacas
    await expect(page.locator('input[id^="q-"]').first()).toHaveValue("600,3333");
    await page.getByRole("button", { name: "Conferir e emitir" }).click();
    await page.getByRole("button", { name: "Emitir nota de teste" }).click();
    await page.waitForURL(/notas-produto\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    const notaId = page.url().split("/").pop()!;

    const { data: o } = await servico!.from("ordens_carregamento").select("status, nfe_emissao_id").eq("id", ordem!.id).single();
    expect(o).toMatchObject({ status: "faturada", nfe_emissao_id: notaId });
    const { data: n } = await servico!.from("nfe_emissoes").select("ambiente, pedido, destinatario_nome").eq("id", notaId).single();
    expect(n!.ambiente).toBe("homologacao");
    const pedido = n!.pedido as { itens: { quantidade: string }[]; transporte: { modalidade: number; placa?: string; rntc?: string }; informacoes?: string };
    expect(pedido.itens[0].quantidade).toBe("600.3333");
    expect(pedido.transporte).toMatchObject({ modalidade: 1, placa: "QBA1C23", rntc: "012345678" });
    expect(pedido.informacoes).toContain("líquido 36.020 kg");

    // A ordem mostra a nota e não pode mais ser alterada
    await page.goto(`/e/${empresaId}/loja/carregamentos/${ordem!.id}`);
    await expect(page.getByText("Com NF-e", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Alterar" })).toHaveCount(0);
  } finally {
    await limpar();
  }
});

test("isolamento: cliente de outra empresa não vê as ordens nem o PDF", async ({ page }) => {
  const { data: ordem } = await servico!.from("ordens_carregamento").select("id").eq("empresa_id", empresaId).eq("numero", 1).single();
  await entrar(page, `cliente@${DOMINIO}`);
  for (const rota of ["/loja/carregamentos", "/loja/carregamentos/nova", `/loja/carregamentos/${ordem!.id}`]) {
    const r = await page.goto(`/e/${empresaId}${rota}`);
    expect(r?.status(), `rota ${rota} deve responder 404`).toBe(404);
  }
  expect((await page.request.get(`/api/loja/carregamentos/${ordem!.id}/pdf`)).status()).toBe(404);
});
