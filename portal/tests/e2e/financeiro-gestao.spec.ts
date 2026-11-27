import { test, expect, type Page, type Browser } from "@playwright/test";

/**
 * Gestão financeira — etapa 1: os cenários de validação pedidos.
 * - venda parcelada com datas e valores escolhidos, criada uma vez só, e recebimento parcial;
 * - compra → pagamento (o caixa diminui) → estorno (o título reabre e o caixa volta);
 * - transferência entre contas não aumenta o disponível nem mexe em pagar/receber;
 * - totais da lista batem com o filtro; renegociação e pagamento em lote;
 * - aprovação: quem lança não aprova; outra pessoa aprova e aí pode pagar;
 * - recorrência: mudar "esta e as próximas";
 * - histórico do cliente a partir do título.
 * Usa os dados fictícios de `npm run seed:demo` (Padaria Pão Dourado).
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const N = Date.now().toString(36).slice(-5);

function hoje(dias = 0) {
  const d = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}
const br = (iso: string) => iso.split("-").reverse().join("/");
const moeda = (t: string) => Number(t.replace(/[^\d,-]/g, "").replace(",", "."));

async function entrar(page: Page, quem: "cliente" | "contador" = "cliente") {
  await page.goto("/login");
  await page.fill('input[name="email"]', `${quem}@${DOMINIO}`);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
  if (quem === "cliente") {
    await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
    return page.url().match(/\/e\/[0-9a-f-]{36}/)![0];
  }
  return "";
}

async function escolherConta(page: Page, busca: string, nome: string) {
  await page.getByRole("combobox", { name: /^Conta/ }).click();
  await page.getByRole("searchbox", { name: "Buscar conta" }).fill(busca);
  await page.getByRole("option", { name: new RegExp(nome) }).first().click();
}

/** Lança uma despesa em aberto pelo formulário e devolve o endereço do título. */
async function novaDespesa(page: Page, empresa: string, descricao: string, valor: string) {
  await page.goto(`${empresa}/financeiro/pagar/novo`);
  await expect(page.getByRole("heading", { name: "Nova despesa" })).toBeVisible();
  await page.fill("#l-valor", valor);
  await page.fill("#l-desc", descricao);
  await escolherConta(page, "outras despesas oper", "Outras despesas operacionais");
  await page.getByLabel(/Já foi pago/).uncheck();
  await page.getByRole("button", { name: "Salvar despesa" }).click();
  await expect(page.getByText("Lançado!")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Ver o lançamento" }).click();
  await expect(page.getByRole("heading", { name: descricao })).toBeVisible();
  return new URL(page.url()).pathname;
}

async function saldoDaConta(page: Page, empresa: string, conta: string) {
  await page.goto(`${empresa}/financeiro`);
  const linha = page.getByRole("list", { name: "Saldo por conta" }).getByRole("listitem").filter({ hasText: conta });
  return moeda(await linha.locator(".numero").innerText());
}

async function selecionarOpcao(page: Page, seletor: string, texto: string) {
  const v = await page.locator(`${seletor} option`, { hasText: texto }).first().getAttribute("value");
  expect(v, `opção "${texto}"`).toBeTruthy();
  await page.selectOption(seletor, v!);
}

test("venda parcelada: parcelas com data e valor escolhidos, criadas uma vez só, e recebimento parcial", async ({ page }) => {
  test.setTimeout(180_000);
  const empresa = await entrar(page);
  const desc = `Venda parcelada E2E ${N}`;
  const venc1 = hoje(10);
  const venc2 = hoje(47);

  await page.goto(`${empresa}/financeiro/receber/novo`);
  await expect(page.getByRole("heading", { name: "Nova receita" })).toBeVisible();
  await page.fill("#l-valor", "900,00");
  await page.fill("#l-data", venc1);
  await page.fill("#l-desc", desc);
  await escolherConta(page, "vendas de mercadorias", "Vendas de mercadorias");
  await page.getByText("Mais detalhes").click();
  await page.getByLabel("Parcelado", { exact: true }).check();
  await page.fill("#l-parc", "3");
  await expect(page.getByRole("list", { name: "Parcelas" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByLabel("Valor da parcela 1")).toHaveValue("300,00");
  // Mudar o valor de uma parcela: a última fecha o total
  await page.getByLabel("Valor da parcela 1").fill("400,00");
  await expect(page.getByLabel("Valor da parcela 3")).toHaveValue("200,00");
  await page.getByLabel("Vencimento da parcela 2").fill(venc2);
  await expect(page.getByTestId("resumo-parcelas")).toContainText("R$ 900,00");
  await page.getByRole("button", { name: "Salvar receita" }).click();
  await expect(page.getByText("Lançado!")).toBeVisible({ timeout: 30_000 });

  // Na lista: exatamente 3 parcelas, com os valores e a data escolhidos
  await page.goto(`${empresa}/financeiro/receber?busca=${encodeURIComponent(desc)}`);
  const linhas = page.getByTestId("linha-titulo");
  await expect(linhas).toHaveCount(3);
  await expect(page.getByTestId("saldo-aberto-filtro")).toHaveText("R$ 900,00");
  await expect(linhas.filter({ hasText: "(1/3)" })).toContainText("R$ 400,00");
  await expect(linhas.filter({ hasText: "(2/3)" })).toContainText(br(venc2));
  await expect(linhas.filter({ hasText: "(3/3)" })).toContainText("R$ 200,00");

  // Recebimento parcial da 1ª parcela
  await linhas.filter({ hasText: "(1/3)" }).getByRole("link", { name: /\(1\/3\)/ }).click();
  await page.getByRole("button", { name: "Registrar recebimento" }).click();
  await selecionarOpcao(page, "#b-conta", "Banco do Brasil");
  await page.fill("#b-principal", "150,00");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Pago em parte", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.goto(`${empresa}/financeiro/receber?busca=${encodeURIComponent(desc)}`);
  await expect(page.getByTestId("linha-titulo")).toHaveCount(3);
  await expect(page.getByTestId("saldo-aberto-filtro")).toHaveText("R$ 750,00");
});

test("compra, pagamento e estorno: o caixa diminui e depois volta", async ({ page }) => {
  test.setTimeout(180_000);
  const empresa = await entrar(page);
  const antes = await saldoDaConta(page, empresa, "Caixa da loja");
  const titulo = await novaDespesa(page, empresa, `Compra E2E ${N}`, "123,45");

  await page.getByRole("button", { name: "Registrar pagamento" }).click();
  await selecionarOpcao(page, "#b-conta", "Caixa da loja");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Registrar pagamento" })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Liquidado", { exact: true }).first()).toBeVisible();
  expect(await saldoDaConta(page, empresa, "Caixa da loja")).toBeCloseTo(antes - 123.45, 2);

  // Estorno com motivo: volta a ficar em aberto e o pagamento fica no histórico
  await page.goto(titulo);
  await page.getByRole("button", { name: "Estornar" }).click();
  await page.getByLabel("Motivo do estorno").fill("Pagamento lançado na conta errada");
  await page.getByRole("alertdialog").getByRole("button", { name: "Estornar" }).click();
  await expect(page.getByRole("button", { name: "Registrar pagamento" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Em aberto", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Pagamento lançado na conta errada").first()).toBeVisible();
  expect(await saldoDaConta(page, empresa, "Caixa da loja")).toBeCloseTo(antes, 2);
});

test("transferência entre contas não aumenta o disponível nem mexe em pagar e receber", async ({ page }) => {
  test.setTimeout(120_000);
  const empresa = await entrar(page);
  await page.goto(`${empresa}/financeiro`);
  const disponivel = await page.getByTestId("saldo-disponivel").innerText();
  const cartoes = async () =>
    Promise.all(["A receber hoje", "A pagar hoje", "Recebimentos vencidos", "Pagamentos vencidos"].map((r) => page.getByRole("link", { name: new RegExp(r) }).first().innerText()));
  const titulosAntes = await cartoes();
  const caixa = await saldoDaConta(page, empresa, "Caixa da loja");

  await page.goto(`${empresa}/financeiro/caixa`);
  await page.getByRole("button", { name: /Transferência entre contas/ }).click();
  await selecionarOpcao(page, "#t-orig", "Banco do Brasil");
  await selecionarOpcao(page, "#t-dest", "Caixa da loja");
  await page.fill("#t-valor", "50,00");
  await page.fill("#t-desc", `Transferência E2E ${N}`);
  await page.getByRole("button", { name: "Registrar transferência" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });

  expect(await saldoDaConta(page, empresa, "Caixa da loja")).toBeCloseTo(caixa + 50, 2);
  await expect(page.getByTestId("saldo-disponivel")).toHaveText(disponivel);
  expect(await cartoes()).toEqual(titulosAntes);
});

test("totais batem com o filtro; renegociação e pagamento em lote", async ({ page }) => {
  test.setTimeout(180_000);
  const empresa = await entrar(page);
  await novaDespesa(page, empresa, `Lote E2E ${N} A`, "100,00");
  await novaDespesa(page, empresa, `Lote E2E ${N} B`, "60,00");

  const lista = `${empresa}/financeiro/pagar?busca=${encodeURIComponent(`Lote E2E ${N}`)}`;
  await page.goto(`${lista}&situacao=em_aberto`);
  await expect(page.getByTestId("linha-titulo")).toHaveCount(2);
  await expect(page.getByTestId("saldo-aberto-filtro")).toHaveText("R$ 160,00");

  // Renegociar os dois num acordo de 2 parcelas com R$ 10,00 de encargos
  await page.getByLabel("Selecionar todos desta página").check();
  await page.getByRole("region", { name: "Ações com os selecionados" }).getByRole("button", { name: "Renegociar" }).click();
  await page.getByLabel("Novo total").fill("170,00");
  await page.getByLabel("Parcelas", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Gerar parcelas" }).click();
  await expect(page.getByTestId("resumo-renegociacao")).toContainText("juros/encargos de R$ 10,00");
  await expect(page.getByLabel("Descrição do acordo")).toHaveValue(new RegExp(`^Acordo: Lote E2E ${N} [AB] e mais 1$`));
  await page.getByLabel("Motivo da renegociação").fill("Fornecedor aceitou parcelar");
  await page.getByRole("button", { name: "Confirmar acordo de R$ 170,00" }).click();
  await expect(page.getByText(/Renegociação registrada/)).toBeVisible({ timeout: 30_000 });

  // Os originais saem da conta (ficam como renegociados) e as parcelas do acordo valem
  await page.goto(lista);
  await expect(page.getByTestId("linha-titulo")).toHaveCount(2);
  await expect(page.getByTestId("linha-titulo").first()).toContainText("Acordo");
  await expect(page.getByTestId("saldo-aberto-filtro")).toHaveText("R$ 170,00");
  await page.goto(`${lista}&situacao=renegociado`);
  await expect(page.getByTestId("linha-titulo")).toHaveCount(2);

  // Pagar as duas parcelas do acordo de uma vez
  await page.goto(lista);
  await page.getByLabel("Selecionar todos desta página").check();
  await page.getByRole("region", { name: "Ações com os selecionados" }).getByRole("button", { name: "Pagar" }).click();
  await selecionarOpcao(page, "#lote-conta", "Banco do Brasil");
  await page.getByRole("button", { name: "Confirmar pagamento de R$ 170,00" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
  // A lista começa pelo que está em aberto; "Todas (sem canceladas)" mostra as liquidadas
  await page.goto(lista);
  await expect(page.getByTestId("linha-titulo")).toHaveCount(0);
  await page.goto(`${lista}&situacao=nao_canceladas`);
  await expect(page.getByTestId("saldo-aberto-filtro")).toHaveText("R$ 0,00");
  await expect(page.getByTestId("linha-titulo").filter({ hasText: "Liquidado" })).toHaveCount(2);
});

test("aprovação: quem lança não aprova; outra pessoa aprova e aí pode pagar", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const empresa = await entrar(page);
  const config = `${empresa}/financeiro/configuracoes?aba=aprovacao`;
  await page.goto(config);
  await page.getByRole("button", { name: "Nova faixa" }).click();
  await page.getByLabel("Valor mínimo da faixa 1").fill("1.000,00");
  await page.getByRole("button", { name: "Salvar aprovação" }).click();
  await expect(page.getByText(/Hoje: a partir de R\$\s1\.000,00/)).toBeVisible({ timeout: 30_000 });
  try {
    const titulo = await novaDespesa(page, empresa, `Equipamento E2E ${N}`, "1.500,00");
    await expect(page.getByText("Aguardando aprovação").first()).toBeVisible();
    await expect(page.getByText(/Você lançou este pagamento/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar pagamento" })).toHaveCount(0);

    await aprovarComoContador(browser, titulo);

    await page.reload();
    await expect(page.getByText("Aprovado: já pode ser pago.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar pagamento" })).toBeVisible();
  } finally {
    await page.goto(config);
    await page.getByRole("button", { name: "Tirar a faixa 1" }).click();
    await page.getByRole("button", { name: "Salvar aprovação" }).click();
    await expect(page.getByText("Nenhuma faixa: os pagamentos não precisam de aprovação.")).toBeVisible({ timeout: 30_000 });
  }
});

async function aprovarComoContador(browser: Browser, titulo: string) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await entrar(p, "contador");
  await p.goto(titulo);
  await p.getByRole("button", { name: "Aprovar pagamento" }).click();
  await expect(p.getByText("Aprovado: já pode ser pago.")).toBeVisible({ timeout: 30_000 });
  await expect(p.getByText("Aprovou").first()).toBeVisible();
  await ctx.close();
}

test("recorrência: mudar o valor desta e das próximas; histórico do cliente", async ({ page }) => {
  test.setTimeout(180_000);
  const empresa = await entrar(page);
  const desc = `Mensalidade E2E ${N}`;
  await page.goto(`${empresa}/financeiro/receber/novo`);
  await page.fill("#l-valor", "99,00");
  await page.fill("#l-data", hoje(5));
  await page.fill("#l-desc", desc);
  await escolherConta(page, "prestação de serviços", "Prestação de serviços");
  await page.getByText("Mais detalhes").click();
  await page.selectOption("#l-contra", { label: "Mercado Bom Preço (DEMO)" });
  await page.getByLabel(/Todo mês ou período/).check();
  await page.getByRole("button", { name: "Salvar receita" }).click();
  await expect(page.getByText("Lançado!")).toBeVisible({ timeout: 30_000 });

  const lista = `${empresa}/financeiro/receber?busca=${encodeURIComponent(desc)}`;
  await page.goto(lista);
  const qtd = await page.getByTestId("linha-titulo").count();
  expect(qtd).toBeGreaterThan(1);
  await page.getByTestId("linha-titulo").first().getByRole("link").first().click();
  await page.getByRole("button", { name: "Alterar recorrência" }).click();
  await page.getByRole("radio", { name: /^Esta e as próximas/ }).check();
  await page.fill("#rec-valor", "120,00");
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
  await page.goto(lista);
  await expect(page.getByTestId("linha-titulo")).toHaveCount(qtd);
  await expect(page.getByTestId("linha-titulo").filter({ hasText: "R$ 99,00" })).toHaveCount(0);

  // Do título para o histórico do cliente
  await page.getByTestId("linha-titulo").first().getByRole("link").first().click();
  await page.getByRole("link", { name: "Mercado Bom Preço (DEMO)" }).click();
  await expect(page.getByRole("heading", { name: "Mercado Bom Preço (DEMO)" })).toBeVisible();
  await expect(page.getByTestId("historico-receber")).toBeVisible();
});
