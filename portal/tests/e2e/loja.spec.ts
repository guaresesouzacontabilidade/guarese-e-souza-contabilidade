import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Gestão da loja (dados fictícios da demonstração, Madeireira Reflorestar):
 *  - o dono vende pelas peças (cubagem em m³), recebe em dinheiro com troco,
 *    imprime o comprovante e o relatório do dia em PDF; a venda baixa o
 *    estoque e entra no Financeiro como recebida;
 *  - venda a prazo exige o cliente e vira uma conta a receber por parcela;
 *  - o balconista abre o próprio caixa, vende, faz sangria e fecha contando a
 *    gaveta, mas não cancela vendas nem mexe nas configurações;
 *  - o dono cancela a venda: o estoque volta e o recebimento é cancelado;
 *  - cliente de outra empresa não vê a loja da madeireira.
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

/** Garante um caixa aberto para quem está logado (abre se preciso). */
async function caixaAberto(page: Page, nome: string) {
  await page.goto(`/e/${empresaId}/loja/vender`);
  const abrir = page.getByRole("button", { name: "Abrir o caixa" });
  if (await abrir.isVisible().catch(() => false)) {
    await page.getByLabel("Nome do caixa").fill(nome);
    await page.getByLabel("Troco inicial na gaveta").fill("100,00");
    await abrir.click();
  }
  await expect(page.getByLabel("Buscar produto")).toBeVisible({ timeout: 30_000 });
}

async function adicionar(page: Page, busca: string, nome: RegExp) {
  await page.getByLabel("Buscar produto").fill(busca);
  await page.getByRole("button", { name: nome }).click();
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
const produtos: Record<string, string> = {};
async function estoque(chave: string) {
  const { data } = await servico!.from("nfe_produtos").select("estoque_atual").eq("id", produtos[chave]).single();
  return Number(data!.estoque_atual);
}

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("razao_social", MADEIREIRA).single();
  empresaId = data!.id;
  const { data: ps } = await servico!.from("nfe_produtos").select("id, descricao").eq("empresa_id", empresaId);
  for (const p of ps ?? []) {
    if (p.descricao.startsWith("Caibro")) produtos.caibro = p.id;
    if (p.descricao.startsWith("Mourão")) produtos.mourao = p.id;
    if (p.descricao.startsWith("Viga")) produtos.viga = p.id;
  }
});

let vendaDinheiro = "";

test("dono: venda pelas peças com troco, comprovante, estoque, Financeiro e relatório do dia", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await caixaAberto(page, "Caixa 1");
  const antesCaibro = await estoque("caibro");
  const antesMourao = await estoque("mourao");

  // 5 caibros 5 × 6 cm de 3 m = 0,045 m³ × R$ 2.200 = R$ 99,00; 10 mourões × R$ 28 = R$ 280,00
  await adicionar(page, "caibro", /Caibro de eucalipto/);
  await page.locator('input[id^="p-"]').first().fill("5");
  await expect(page.getByText("0,045 m³")).toBeVisible();
  await adicionar(page, "mourão", /Mourão de eucalipto/);
  await page.locator('input[id^="q-"]').first().fill("10");
  await page.getByLabel("Nome do cliente (sem cadastro)").fill("Cliente E2E balcão");
  await page.getByRole("group", { name: "Formas de pagamento" }).getByRole("button", { name: /Dinheiro/ }).click();
  await page.locator('input[id^="rec-"]').fill("400");
  await expect(page.getByText("Troco: R$ 21,00")).toBeVisible();
  await page.getByRole("button", { name: "Concluir venda" }).click();

  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toContainText("concluída");
  await expect(dialogo).toContainText("R$ 379,00");
  vendaDinheiro = (await dialogo.getByRole("link", { name: "Ver a venda" }).getAttribute("href"))!.split("/").pop()!;
  await dialogo.getByRole("button", { name: "Nova venda" }).click();

  expect(await estoque("caibro")).toBeCloseTo(antesCaibro - 0.045, 4);
  expect(await estoque("mourao")).toBe(antesMourao - 10);

  // Financeiro: recebida no caixa da loja
  const { data: lancs } = await servico!.from("lancamentos").select("situacao, valor_previsto, origem").eq("origem_referencia", vendaDinheiro);
  expect(lancs).toEqual([{ situacao: "quitado", valor_previsto: 379, origem: "venda" }]);

  // Comprovante (não fiscal)
  await page.goto(`/impressao/venda/${vendaDinheiro}`);
  await expect(page.getByText("NÃO É DOCUMENTO FISCAL")).toBeVisible();
  await expect(page.getByText("R$ 21,00")).toBeVisible();

  // Caixa do dia e relatório em PDF
  await page.goto(`/e/${empresaId}/loja/caixa`);
  await expect(page.getByText("Cliente E2E balcão").first()).toBeVisible();
  const link = await page.locator('a[href*="/api/loja/caixa/"]').first().getAttribute("href");
  const pdf = await page.request.get(link!.replace("?ver=1", ""));
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Logo da empresa (usada nos relatórios impressos e no comprovante)
  const logo = await page.request.get(`/api/empresas/${empresaId}/logo`);
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toBe("image/png");
});

test("dono: venda a prazo exige cliente e gera uma conta a receber por parcela", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `madeireira@${DOMINIO}`);
  await caixaAberto(page, "Caixa 1");
  // 4 vigas 6 × 12 de 4 m = 0,1152 m³ × R$ 2.300 = R$ 264,96
  await adicionar(page, "viga", /Viga de eucalipto/);
  await page.locator('input[id^="p-"]').first().fill("4");
  await expect(page.getByText("0,1152 m³")).toBeVisible();
  await page.getByRole("group", { name: "Formas de pagamento" }).getByRole("button", { name: /A prazo/ }).click();
  await page.locator('select[id^="parc-"]').selectOption("2");

  // Sem cliente: recusa
  await page.getByRole("button", { name: "Concluir venda" }).click();
  await expect(page.getByText(/escolha o cliente|cliente cadastrado|informe o cliente/i).first()).toBeVisible();

  await page.getByLabel("Buscar cliente").fill("João Carpinteiro");
  await page.getByRole("button", { name: /João Carpinteiro/ }).click();
  await page.getByRole("button", { name: "Concluir venda" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toContainText("R$ 264,96");
  const venda = (await dialogo.getByRole("link", { name: "Ver a venda" }).getAttribute("href"))!.split("/").pop()!;
  await dialogo.getByRole("button", { name: "Nova venda" }).click();

  const { data: parcelas } = await servico!
    .from("lancamentos")
    .select("situacao, valor_previsto, parcela_numero")
    .eq("origem_referencia", venda)
    .order("parcela_numero");
  expect(parcelas).toEqual([
    { situacao: "aberto", valor_previsto: 132.48, parcela_numero: 1 },
    { situacao: "aberto", valor_previsto: 132.48, parcela_numero: 2 },
  ]);

  await page.goto(`/e/${empresaId}/loja/vendas/${venda}`);
  await expect(page.getByText("No Financeiro")).toBeVisible();
  await expect(page.getByText("A receber").first()).toBeVisible();
});

test("balconista: abre o próprio caixa, vende no PIX, faz sangria e fecha; não cancela nem configura", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `balcao@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/configuracoes`);
  await expect(page.getByText("Você não tem acesso à loja")).toBeVisible();

  await caixaAberto(page, "Caixa E2E");
  await adicionar(page, "mourão", /Mourão de eucalipto/);
  await page.locator('input[id^="q-"]').first().fill("3");
  await page.getByRole("group", { name: "Formas de pagamento" }).getByRole("button", { name: /PIX/ }).click();
  await page.getByRole("button", { name: "Concluir venda" }).click();
  await expect(page.getByRole("dialog")).toContainText("R$ 84,00");
  await page.getByRole("dialog").getByRole("button", { name: "Nova venda" }).click();

  // A venda do dono não pode ser cancelada pelo balconista
  await page.goto(`/e/${empresaId}/loja/vendas/${vendaDinheiro}`);
  await expect(page.getByRole("button", { name: "Cancelar venda" })).toHaveCount(0);

  await page.goto(`/e/${empresaId}/loja/caixa`);
  await page.getByRole("button", { name: /Sangria/ }).click();
  await page.getByLabel("Valor").fill("50,00");
  await page.getByLabel("Motivo").fill("Troco levado ao cofre (E2E)");
  await page.getByRole("button", { name: "Registrar sangria" }).click();
  await expect(page.getByText("Troco levado ao cofre (E2E)")).toBeVisible();

  // Sobrou 100 − 50 = R$ 50,00 na gaveta (a venda foi no PIX)
  await page.getByRole("button", { name: "Fechar o caixa" }).click();
  await page.getByLabel("Dinheiro contado").fill("50,00");
  await expect(page.getByText("Conferiu certinho.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Fechar o caixa" }).click();
  await expect(page.getByText("Você não está com um caixa aberto")).toBeVisible({ timeout: 30_000 });
});

test("dono: cancela a venda, o estoque volta e o recebimento é cancelado", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!vendaDinheiro, "Depende da primeira venda.");
  const antes = await estoque("mourao");
  await entrar(page, `madeireira@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/loja/vendas/${vendaDinheiro}`);
  await page.getByRole("button", { name: "Cancelar venda" }).click();
  await page.getByLabel("Motivo").fill("Cliente desistiu (E2E)");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar venda" }).click();
  await expect(page.getByText(/Venda cancelada em/)).toBeVisible({ timeout: 30_000 });
  expect(await estoque("mourao")).toBe(antes + 10);
  const { data: lancs } = await servico!.from("lancamentos").select("situacao").eq("origem_referencia", vendaDinheiro);
  expect(lancs).toEqual([{ situacao: "cancelado" }]);
});

test("NF-e da venda: sem certificado a emissão fica desconectada e nada é enviado", async ({ page }) => {
  await entrar(page, `madeireira@${DOMINIO}`);
  const { data: v } = await servico!.from("vendas").select("id").eq("empresa_id", empresaId).eq("tipo", "venda").eq("status", "concluida").limit(1).single();
  await page.goto(`/e/${empresaId}/loja/vendas/${v!.id}`);
  await page.getByRole("link", { name: /Emitir NF-e desta venda/ }).click();
  await page.waitForURL(/notas-produto\/nova\?venda=/);
  await expect(page.getByText("Emissão desconectada")).toBeVisible();
});

test("NF-e na hora da venda: completa o endereço do cliente, conclui e a nota sai ligada à venda (sem rede: nada vai à SEFAZ)", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(process.env.NOTAS_AUTOMATICAS_SEM_REDE !== "1", "Só roda com as consultas fiscais desligadas neste ambiente.");
  const { data: emp } = await servico!.from("empresas").select("documento").eq("id", empresaId).single();
  const { data: joao } = await servico!.from("contrapartes").select("documento").eq("empresa_id", empresaId).ilike("nome", "João Carpinteiro%").single();
  const limpar = async () => {
    await servico!.from("nfe_config").update({ ativa: false, autorizacao_texto: null, autorizado_em: null }).eq("empresa_id", empresaId);
    await servico!.from("certificados_digitais").delete().eq("empresa_id", empresaId).eq("titular", "CERTIFICADO FICTICIO (E2E)");
    await servico!.from("jobs").delete().eq("empresa_id", empresaId).eq("tipo", "emitir_nfe");
  };
  await limpar();
  await servico!.from("nfe_destinatarios").delete().eq("empresa_id", empresaId).eq("documento", joao!.documento);
  // Emissão ligada só neste teste, com um certificado FICTÍCIO (sem rede, nada é enviado à SEFAZ)
  await servico!.from("certificados_digitais").insert({
    empresa_id: empresaId,
    titular: "CERTIFICADO FICTICIO (E2E)",
    documento: emp!.documento,
    impressao_digital: "E".repeat(64),
    valido_de: new Date(Date.now() - 86_400_000).toISOString(),
    valido_ate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    autorizacao: "autorizacao_escrita",
    autorizacao_texto: "Teste automático (E2E).",
  });
  await servico!.from("nfe_config").update({ ativa: true, autorizacao_texto: "Teste automático (E2E).", autorizado_em: new Date().toISOString() }).eq("empresa_id", empresaId);
  try {
    await entrar(page, `madeireira@${DOMINIO}`);
    await caixaAberto(page, "Caixa 1");
    const caixinha = page.getByLabel("Emitir NF-e ao concluir a venda");
    await expect(caixinha).toBeEnabled();
    await caixinha.check();
    await adicionar(page, "mourão", /Mourão de eucalipto/);
    await page.locator('input[id^="q-"]').first().fill("2");
    await page.getByLabel("Buscar cliente").fill("João Carpinteiro");
    await page.getByRole("button", { name: /João Carpinteiro/ }).click();

    // O cliente ainda não tem endereço para a nota: completa ali mesmo
    await expect(page.getByText("Falta o endereço do cliente para a nota.")).toBeVisible();
    await page.getByRole("button", { name: "Completar endereço" }).click();
    const dialogo = page.getByRole("dialog");
    await dialogo.locator("#d-lgr").fill("Rua Fictícia dos Testes");
    await dialogo.locator("#d-nro").fill("10");
    await dialogo.locator("#d-bairro").fill("Centro");
    await dialogo.locator("#d-mun-uf").selectOption("TO");
    await expect(dialogo.locator('#d-mun option[value="1718204"]')).toHaveCount(1, { timeout: 30_000 });
    await dialogo.locator("#d-mun").selectOption("1718204");
    await dialogo.locator("#d-cep").fill("77500000");
    await dialogo.getByRole("button", { name: /Salvar/ }).click();
    await expect(page.getByText("Falta o endereço do cliente para a nota.")).toHaveCount(0, { timeout: 30_000 });

    await page.getByRole("group", { name: "Formas de pagamento" }).getByRole("button", { name: /PIX/ }).click();
    await page.getByRole("button", { name: "Concluir venda e emitir NF-e" }).click();
    const concluida = page.getByRole("dialog");
    await expect(concluida).toContainText("concluída", { timeout: 60_000 });
    await expect(concluida).toContainText("NF-e");
    const venda = (await concluida.getByRole("link", { name: "Ver a venda" }).getAttribute("href"))!.split("/").pop()!;
    await expect(concluida.getByRole("link", { name: "Ver a nota" })).toBeVisible();

    // A nota ficou ligada à venda, no ambiente de teste da SEFAZ (homologação)
    const { data: v } = await servico!.from("vendas").select("nfe_emissao_id").eq("id", venda).single();
    expect(v!.nfe_emissao_id).toBeTruthy();
    const { data: n } = await servico!.from("nfe_emissoes").select("ambiente, valor_total, destinatario_nome").eq("id", v!.nfe_emissao_id!).single();
    expect(n!.ambiente).toBe("homologacao");
    expect(Number(n!.valor_total)).toBe(56);
    // Sem rede, a SEFAZ nunca responde: o caixa mostra a situação real (nada é fingido)
    await expect(concluida.getByText(/Sem resposta|Emitindo|Enviando à SEFAZ|Rejeitada/).first()).toBeVisible({ timeout: 60_000 });
    await expect(concluida.getByText("Autorizada")).toHaveCount(0);
  } finally {
    await limpar();
  }
});

test("isolamento: cliente de outra empresa não vê a loja da madeireira", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  for (const rota of ["/loja", "/loja/vender", "/loja/caixa", "/loja/produtos", `/loja/vendas/${vendaDinheiro || "00000000-0000-0000-0000-000000000000"}`]) {
    const r = await page.goto(`/e/${empresaId}${rota}`);
    expect(r?.status(), `rota ${rota} deve responder 404`).toBe(404);
  }
  if (vendaDinheiro) {
    const r = await page.goto(`/impressao/venda/${vendaDinheiro}`);
    expect(r?.status()).toBe(404);
  }
  expect((await page.request.get(`/api/empresas/${empresaId}/logo`)).status()).toBe(404);
});
