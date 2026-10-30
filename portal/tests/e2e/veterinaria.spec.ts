import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Clínica veterinária (clínica fictícia da demonstração):
 *  - a recepção cadastra tutor e animal, mas não abre atendimento;
 *  - a veterinária atende, aplica vacina (com fabricante, partida, fabricação e
 *    validade; a dose sai do estoque), dá baixa de 0,5 mL de um medicamento
 *    cobrando na conta, emite a receita e finaliza; a receita sai em 2 vias e a
 *    carteira de vacinação em PDF, com a identidade da clínica e sem a marca
 *    do escritório;
 *  - a recepção vê o retorno nos lembretes, cobra e recebe (o pagamento vai
 *    para o Financeiro);
 *  - cliente de outra empresa não vê a clínica nem os PDFs.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

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
  await page.waitForLoadState("networkidle");
  // Primeiro acesso: aceita os termos (a tela aparece no lugar da página pedida)
  if (page.url().includes("/aceite") || (await page.getByText("Antes de começar").count())) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.getByRole("button", { name: /Concordar/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
    await page.waitForLoadState("networkidle");
  }
}

function cpfAleatorio() {
  const base = String(Math.floor(100000000 + Math.random() * 800000000));
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base);
  return `${base}${d1}${calc(base + d1)}`;
}

const hojeLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
const somarDias = (data: string, dias: number) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Páginas do PDF (cada página tem um objeto "/Type /Page"). */
function paginas(pdf: Buffer) {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
}

test.describe.configure({ mode: "serial" });

const sufixo = Date.now().toString(36).slice(-5);
const tutor = `Tutora Teste ${sufixo} (fictícia)`;
const animal = `Mimi ${sufixo}`;
let empresaId = "";
let pacienteId = "";
let atendimentoId = "";
let contaId = "";

test.beforeAll(async () => {
  const admin = clienteServico();
  test.skip(!admin, "Sem acesso ao banco local");
  const { data } = await admin!.from("empresas").select("id").ilike("nome_fantasia", "Clínica Veterinária Amigo Fiel%").eq("demonstracao", true).maybeSingle();
  test.skip(!data, "Clínica de demonstração não encontrada (rode o seed)");
  empresaId = data!.id as string;
});

test("recepção: cadastra tutor e animal, mas não abre atendimento", async ({ page }) => {
  await entrar(page, `atendimento@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/veterinaria/pacientes`);
  await page.getByRole("button", { name: "Novo tutor" }).click();
  await page.fill("#tu-nome", tutor);
  await page.fill("#tu-cpf", cpfAleatorio());
  await page.fill("#tu-telefone", "63999990123");
  await page.fill("#tu-logradouro", "Rua do Teste Automático");
  await page.fill("#tu-numero", "10");
  await page.fill("#tu-bairro", "Centro");
  await page.fill("#tu-cidade", "Porto Nacional");
  await page.fill("#tu-uf", "TO");
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.waitForURL(/\/veterinaria\/tutores\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  await page.getByRole("button", { name: "Novo animal" }).click();
  await page.fill("#pa-nome", animal);
  await page.selectOption("#pa-especie", "felina");
  await page.selectOption("#pa-sexo", "femea");
  await page.fill("#pa-nascimento", somarDias(hojeLocal(), -100));
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.waitForURL(/\/veterinaria\/pacientes\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  pacienteId = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { name: animal })).toBeVisible();
  // Atos clínicos são só do veterinário
  await expect(page.getByRole("button", { name: /Atender agora/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Aplicar vacina/ })).toHaveCount(0);
});

test("veterinária: atende, aplica a vacina, emite a receita e finaliza; PDFs da clínica", async ({ page }) => {
  await entrar(page, `veterinaria@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/veterinaria/pacientes/${pacienteId}`);
  await page.getByRole("button", { name: /Atender agora/ }).click();
  await page.waitForURL(/\/veterinaria\/atendimentos\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  atendimentoId = page.url().split("/").pop()!;

  await page.fill("#pr-relato", "Primeira consulta da filhote (teste automático).");
  await page.fill("#pr-peso", "1,8");
  await page.fill("#pr-temp", "38,5");
  await page.fill("#pr-dp", "Filhote saudável.");
  await page.fill("#pr-retorno", somarDias(hojeLocal(), 5));
  await page.fill("#pr-retorno-motivo", "Pesar e avaliar o apetite");
  await page.getByRole("button", { name: /Salvar prontuário/ }).click();
  await expect(page.getByText("Prontuário salvo.")).toBeVisible();

  // Estoque antes: vacina felina por dose (ligada ao catálogo) e o medicamento em mL
  const admin = clienteServico()!;
  const estoque = async (descricao: string) => {
    const { data } = await admin.from("nfe_produtos").select("id, estoque_atual").eq("empresa_id", empresaId).ilike("descricao", `${descricao}%`).single();
    return { id: data!.id as string, saldo: Number(data!.estoque_atual) };
  };
  const v4Antes = await estoque("Vacina polivalente felina");
  const dipironaAntes = await estoque("Dipirona");

  // Vacina da clínica: sem os dados do frasco não registra
  await page.getByRole("button", { name: /Aplicar vacina/ }).click();
  await page.selectOption("#va-vacina", { label: "Polivalente felina (V3/V4/V5)" });
  await page.fill("#va-fab", "Laboratório Teste (fictício)");
  await page.fill("#va-partida", `T${sufixo}`);
  await page.fill("#va-fabricacao", somarDias(hojeLocal(), -90));
  await page.fill("#va-validade", somarDias(hojeLocal(), 300));
  await expect(page.locator("#va-proxima")).toHaveValue(somarDias(hojeLocal(), 21));
  await page.getByRole("button", { name: "Registrar aplicação" }).click();
  await expect(page.getByText(`T${sufixo}`).first()).toBeVisible();
  // A vacina aplicada tira 1 dose do estoque
  expect((await estoque("Vacina polivalente felina")).saldo).toBe(v4Antes.saldo - 1);

  // Medicamento usado no atendimento: 0,5 mL sai do estoque e vai para a conta do tutor
  await page.selectOption("#us-produto", dipironaAntes.id);
  await page.fill("#us-qtd", "0,5");
  await page.getByLabel("Cobrar na conta do tutor").check();
  await page.getByRole("button", { name: /Dar baixa/ }).click();
  await expect(page.getByText("Baixa no estoque e cobrança na conta registradas.")).toBeVisible();
  await expect(page.getByText(/cobrado R\$\s?0,60/)).toBeVisible();
  expect((await estoque("Dipirona")).saldo).toBeCloseTo(dipironaAntes.saldo - 0.5, 4);

  // Receita comum a partir do atendimento
  await page.getByRole("link", { name: /Nova receita/ }).click();
  await page.waitForURL(/\/veterinaria\/receitas\/nova/);
  await page.getByRole("textbox", { name: /^Medicamento/ }).fill("Vermífugo felino (pasta oral)");
  await page.getByRole("textbox", { name: /^Quantidade/ }).fill("1 bisnaga");
  await page.getByRole("textbox", { name: /^Posologia/ }).fill("Dar 1 mL por via oral, dose única; repetir em 15 dias.");
  await page.getByRole("button", { name: "Emitir receita" }).click();
  await page.waitForURL(/\/veterinaria\/receitas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const receitaId = page.url().split("/").pop()!;
  const receita = await page.request.get(`/api/veterinaria/${empresaId}/receitas/${receitaId}`);
  expect(receita.status()).toBe(200);
  expect(receita.headers()["content-type"]).toContain("application/pdf");
  const corpo = Buffer.from(await receita.body());
  expect(corpo.toString("latin1").startsWith("%PDF")).toBe(true);
  // Receita comum: via do responsável e via do arquivo
  expect(paginas(corpo)).toBe(2);
  expect(corpo.toString("latin1")).not.toMatch(/Guarese/i);

  // Finaliza: depois disso o prontuário não muda (só adendo)
  await page.goto(`/e/${empresaId}/veterinaria/atendimentos/${atendimentoId}`);
  await page.getByRole("button", { name: /Finalizar atendimento/ }).click();
  await page.getByRole("button", { name: "Finalizar", exact: true }).click();
  await expect(page.getByText("Finalizado").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Adendo/ })).toBeVisible();
  await expect(page.locator("#pr-relato")).toHaveCount(0);

  const carteira = await page.request.get(`/api/veterinaria/${empresaId}/carteira/${pacienteId}`);
  expect(carteira.status()).toBe(200);
  expect(paginas(Buffer.from(await carteira.body()))).toBeGreaterThanOrEqual(1);
  const prontuario = await page.request.get(`/api/veterinaria/${empresaId}/prontuario/${pacienteId}`);
  expect(prontuario.status()).toBe(200);
});

test("recepção: vê o retorno nos lembretes, cobra e recebe (vai para o Financeiro)", async ({ page }) => {
  await entrar(page, `atendimento@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/veterinaria/lembretes`);
  const linha = page.locator("tr", { hasText: animal });
  await expect(linha.first()).toBeVisible();
  await expect(linha.first().getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/5563999990123\?text=/);

  await page.goto(`/e/${empresaId}/veterinaria/atendimentos/${atendimentoId}`);
  await page.getByRole("button", { name: /Cobrar/ }).click();
  await page.waitForURL(/\/veterinaria\/contas\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  contaId = page.url().split("/").pop()!;
  const consulta = await page.locator("#ci-servico option", { hasText: /^Consulta —/ }).getAttribute("value");
  await page.selectOption("#ci-servico", consulta!);
  await page.getByRole("button", { name: /Lançar/ }).click();
  await expect(page.getByText("Lançado na conta.")).toBeVisible();
  await page.getByRole("button", { name: /Receber/ }).click();
  await page.selectOption("#cp-forma", "pix");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("button", { name: /Receber/ })).toBeDisabled();
  await page.getByRole("button", { name: "Fechar conta" }).click();
  await page.getByRole("button", { name: "Fechar conta" }).last().click();
  await expect(page.getByText("Paga").first()).toBeVisible();

  const admin = clienteServico()!;
  const { data: pagamentos } = await admin.from("vet_pagamentos").select("lancamento_id, valor").eq("conta_id", contaId).is("cancelado_em", null);
  expect(pagamentos?.length).toBe(1);
  const { data: lanc } = await admin.from("lancamentos").select("origem, situacao, valor_previsto, valor_baixado").eq("id", pagamentos![0].lancamento_id!).single();
  expect(lanc?.origem).toBe("veterinaria");
  expect(Number(lanc?.valor_baixado)).toBe(Number(pagamentos![0].valor));
});

test("dona: nota de serviço a partir da conta (emissão desconectada até o escritório ligar)", async ({ page }) => {
  await entrar(page, `veterinaria@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/veterinaria/contas/${contaId}`);
  await page.getByRole("link", { name: /Emitir nota de serviço/ }).click();
  await page.waitForURL(new RegExp(`/notas-servico/nova\\?conta=${contaId}`));
  // Sem certificado e sem a configuração do escritório, nada é enviado
  await expect(page.getByText("Emissão desconectada")).toBeVisible();
});

test("escritório: ração com a regra fiscal própria (ST) e a regra em vários produtos de uma vez", async ({ page }) => {
  const admin = clienteServico()!;
  const { data: antipulgas } = await admin.from("nfe_produtos").select("id").eq("empresa_id", empresaId).ilike("descricao", "Antipulgas%").single();
  await admin.from("nfe_produtos").update({ operacao_id: null }).eq("id", antipulgas!.id);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/notas-produto/configuracao`);
  // A ração sai com 5.405/CSOSN 500 mesmo junto com outros produtos na nota
  await expect(page.getByRole("row", { name: /Ração premium/ })).toContainText("Venda com ST - ração (DEMO)");
  await expect(page.getByRole("row", { name: /Antipulgas/ })).toContainText("A da nota");
  await expect(page.getByText(/CFOP 5405 — ICMS 500/)).toBeVisible();

  const alvo = page.locator("#pr-alvo");
  const valorSt = await alvo.locator("option", { hasText: "Venda com ST - ração (DEMO)" }).getAttribute("value");
  await page.getByRole("checkbox", { name: /^Marcar Antipulgas/ }).check();
  await alvo.selectOption(valorSt!);
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("1 produto atualizado.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("row", { name: /Antipulgas/ })).toContainText("Venda com ST - ração (DEMO)");

  // Volta à operação da nota
  await page.getByRole("checkbox", { name: /^Marcar Antipulgas/ }).check();
  await alvo.selectOption("");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("row", { name: /Antipulgas/ })).toContainText("A da nota", { timeout: 30_000 });
  const { data: depois } = await admin.from("nfe_produtos").select("operacao_id").eq("id", antipulgas!.id).single();
  expect(depois!.operacao_id).toBeNull();

  // No cadastro do produto, a regra própria aparece escolhida
  await page.getByRole("row", { name: /Ração premium/ }).getByRole("button", { name: "Editar" }).click();
  await expect(page.getByRole("dialog").locator("#pr-operacao")).toHaveValue(valorSt!);
});

test("dona: importa tutores e animais de uma planilha do sistema antigo, sem duplicar ao importar de novo", async ({ page }) => {
  const n = Date.now().toString().slice(-6);
  const admin = clienteServico()!;
  const csv = [
    "Cliente;CPF;Celular;Animal;Espécie;Sexo;Nascimento",
    `TUTORA IMPORTADA ${n};;(63) 99${n.slice(0, 3)}-${n.slice(3)}0;Paçoca ${n};Cão;Fêmea;10/02/2022`,
    `TUTORA IMPORTADA ${n};;(63) 99${n.slice(0, 3)}-${n.slice(3)}0;Biscoito ${n};Gato;M;`,
    `;;;Sem espécie ${n};;;`,
  ].join("\n");
  const arquivo = { name: "clientes-sistema-antigo.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") };
  try {
    await entrar(page, `veterinaria@${DOMINIO}`);
    await page.goto(`/e/${empresaId}/veterinaria/pacientes`);
    await page.getByRole("link", { name: /Importar planilha/ }).click();
    await page.waitForURL(/\/veterinaria\/importar/);
    const modelo = await page.request.get(`/api/veterinaria/${empresaId}/modelo-importacao`);
    expect(modelo.status()).toBe(200);
    expect(modelo.headers()["content-type"]).toContain("spreadsheetml");

    await page.locator("#imp-arquivo").setInputFiles(arquivo);
    await page.getByRole("button", { name: "Conferir a planilha" }).click();
    await expect(page.getByText("3 linha(s), tutores e animais")).toBeVisible({ timeout: 30_000 });
    // O animal sem espécie fica de fora até escolher a espécie padrão
    await expect(page.getByRole("button", { name: "Importar 1 tutor(es) novo(s) e 2 animal(is)" })).toBeVisible();
    await page.locator("#imp-especie").selectOption("canina");
    await expect(page.getByText(`Tutora Importada ${n}`)).toBeVisible();
    await page.getByRole("button", { name: "Importar 1 tutor(es) novo(s) e 3 animal(is)" }).click();
    await expect(page.getByText("1 tutor(es) novo(s) e 3 animal(is) novo(s) cadastrados.")).toBeVisible({ timeout: 30_000 });

    const { data: tutor } = await admin.from("vet_tutores").select("id, nome, telefone").eq("empresa_id", empresaId).eq("nome", `Tutora Importada ${n}`).single();
    expect(tutor!.telefone).toBe(`6399${n}0`);
    const { data: animais } = await admin.from("vet_pacientes").select("nome, especie, sexo, nascimento").eq("tutor_id", tutor!.id).order("nome");
    expect(animais!.map((a) => `${a.nome}|${a.especie}|${a.sexo}|${a.nascimento ?? ""}`)).toEqual([
      `Biscoito ${n}|felina|macho|`,
      `Paçoca ${n}|canina|femea|2022-02-10`,
      `Sem espécie ${n}|canina|indefinido|`,
    ]);

    // A mesma planilha de novo: nada novo
    await page.getByRole("button", { name: "Conferir a planilha" }).click();
    await expect(page.getByText("Nada novo para importar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Já cadastrado").first()).toBeVisible();
  } finally {
    const { data: criados } = await admin.from("vet_tutores").select("id").eq("empresa_id", empresaId).like("nome", `%${n}%`);
    const ids = (criados ?? []).map((t) => t.id);
    if (ids.length) {
      await admin.from("vet_pacientes").delete().in("tutor_id", ids);
      await admin.from("vet_tutores").delete().in("id", ids);
    }
  }
});

test("recepção não importa a planilha de tutores", async ({ page }) => {
  await entrar(page, `atendimento@${DOMINIO}`);
  expect((await page.request.get(`/api/veterinaria/${empresaId}/modelo-importacao`)).status()).toBe(403);
  await page.goto(`/e/${empresaId}/veterinaria/pacientes`);
  await expect(page.getByRole("link", { name: /Importar planilha/ })).toHaveCount(0);
  await page.goto(`/e/${empresaId}/veterinaria/importar`);
  await expect(page.getByText("Só o responsável pela clínica importa tutores e animais.")).toBeVisible();
});

test("cliente de outra empresa não vê a clínica nem os documentos", async ({ page }) => {
  await entrar(page, `cliente@${DOMINIO}`);
  for (const rota of [`carteira/${pacienteId}`, `prontuario/${pacienteId}`]) {
    expect((await page.request.get(`/api/veterinaria/${empresaId}/${rota}`)).status()).toBe(403);
  }
  expect((await page.request.get(`/api/veterinaria/${empresaId}/pacientes?busca=Mimi`)).status()).toBe(403);
  await page.goto(`/e/${empresaId}/veterinaria/pacientes`);
  await expect(page.getByText(animal)).toHaveCount(0);
});
