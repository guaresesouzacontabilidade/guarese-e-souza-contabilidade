import { test, expect, type Page } from "@playwright/test";

/**
 * Financeiro mais fácil para o gestor da empresa: plano de contas editável
 * (grupo e conta com código sugerido, excluir movendo os lançamentos),
 * lançamento rápido (formulário curto, busca e sugestão de conta pelo
 * histórico, lançar de novo) e DRE personalizado com ajustes no resultado.
 * Usa os dados fictícios de `npm run seed:demo`.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const N = Date.now().toString(36).slice(-5);

async function entrar(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', `cliente@${DOMINIO}`);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return page.url().match(/\/e\/[0-9a-f-]{36}/)![0];
}

async function escolherConta(page: Page, busca: string, nome: string) {
  await page.getByRole("combobox", { name: /^Conta/ }).click();
  await page.getByRole("searchbox", { name: "Buscar conta" }).fill(busca);
  await page.getByRole("option", { name: new RegExp(nome) }).first().click();
}

async function valorDaOpcao(page: Page, select: string, texto: string) {
  const v = await page.locator(`${select} option`, { hasText: texto }).first().getAttribute("value");
  expect(v, `opção "${texto}"`).toBeTruthy();
  return v!;
}

test("plano de contas: grupo e conta com código sugerido; excluir movendo os lançamentos", async ({ page }) => {
  test.setTimeout(180_000);
  const empresa = await entrar(page);
  await page.goto(`${empresa}/financeiro/cadastros`);

  // Grupo próprio com código sugerido
  await page.getByRole("button", { name: "Novo grupo" }).click();
  await page.fill("#cat-nome", `Pessoal E2E ${N}`);
  await expect(page.locator("#cat-cod")).toHaveValue(/^\d+$/);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Grupo criado.")).toBeVisible();
  const grupo = page.getByRole("region", { name: `Grupo Pessoal E2E ${N}` });
  await expect(grupo).toBeVisible();

  // Conta dentro do grupo: código do grupo + .01 e a linha do DRE em que aparece
  await grupo.getByRole("button", { name: `Nova conta em Pessoal E2E ${N}` }).click();
  await page.fill("#cat-nome", `Festa E2E ${N}`);
  await expect(page.locator("#cat-cod")).toHaveValue(/^\d+\.01$/);
  await expect(page.getByText("No DRE, aparece em: (−) Despesas operacionais")).toBeVisible();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Conta criada.")).toBeVisible();
  await expect(grupo.getByText(`Festa E2E ${N}`)).toBeVisible();

  // Um lançamento na conta nova (formulário rápido)
  await page.goto(`${empresa}/financeiro/lancamentos/novo?tipo=pagar`);
  await expect(page.getByRole("heading", { name: "Nova despesa" })).toBeVisible();
  await page.fill("#l-valor", "150,00");
  await page.fill("#l-desc", `Confraternização E2E ${N}`);
  await escolherConta(page, `festa e2e ${N}`, `Festa E2E ${N}`);
  await page.getByLabel(/Já foi pago/).uncheck();
  await page.getByRole("button", { name: "Salvar despesa" }).click();
  await expect(page.getByText("Lançado!")).toBeVisible({ timeout: 30_000 });

  // Excluir a conta: pede o destino e move o lançamento
  await page.goto(`${empresa}/financeiro/cadastros`);
  await page.getByRole("button", { name: `Excluir Festa E2E ${N}` }).click();
  await expect(page.getByText(/Esta conta tem 1 lançamento\(s\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mover e excluir" })).toBeDisabled();
  await page.selectOption("#exc-destino", await valorDaOpcao(page, "#exc-destino", "Outras despesas operacionais"));
  await page.getByRole("button", { name: "Mover e excluir" }).click();
  await expect(page.getByText(/Conta “?"?Festa E2E .*excluída\. 1 lançamento\(s\) foram para a conta escolhida\./)).toBeVisible();

  // Grupo vazio sai direto; conta do sistema não tem botão de excluir
  await page.getByRole("button", { name: `Excluir Pessoal E2E ${N}` }).click();
  await expect(page.getByText("O grupo está vazio.")).toBeVisible();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(page.getByRole("region", { name: `Grupo Pessoal E2E ${N}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Excluir Tarifas bancárias" })).toHaveCount(0);

  // O lançamento continua, agora na outra conta
  await page.goto(`${empresa}/financeiro/lancamentos?busca=${encodeURIComponent(`Confraternização E2E ${N}`)}`);
  await expect(page.getByText(`Confraternização E2E ${N}`).first()).toBeVisible();
});

test("lançamento rápido: busca da conta, sugestão pelo histórico e lançar de novo", async ({ page }) => {
  test.setTimeout(180_000);
  const empresa = await entrar(page);
  await page.goto(`${empresa}/financeiro`);
  await page.getByRole("link", { name: "Despesa" }).first().click();
  await expect(page.getByRole("heading", { name: "Nova despesa" })).toBeVisible();

  // Formulário curto: o resto fica em "Mais detalhes"
  await expect(page.locator("#l-cc")).toBeHidden();
  await page.fill("#l-valor", "89,90");
  await page.fill("#l-desc", `Internet fibra E2E ${N}`);
  await escolherConta(page, "internet", "Energia, água, telefone e internet");
  await expect(page.getByLabel(/Já foi pago/)).toBeChecked();
  await expect(page.locator("#l-cpag")).not.toHaveValue("");
  await page.getByRole("button", { name: "Salvar despesa" }).click();
  await expect(page.getByText("Lançado!")).toBeVisible({ timeout: 30_000 });
  // Pronto para o próximo: continua despesa, campos limpos
  await expect(page.locator("#l-desc")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Despesa saída de dinheiro" })).toHaveAttribute("aria-pressed", "true");

  // Descrição parecida: a conta vem sugerida pelo histórico da empresa
  await page.fill("#l-desc", `internet fibra janeiro`);
  await expect(page.getByText(/Sugerida por um lançamento parecido/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Conta: .*Energia, água, telefone e internet/ })).toBeVisible();
  // A conta usada aparece nas mais usadas
  await expect(page.getByRole("group", { name: "Contas mais usadas" }).getByRole("button", { name: "Energia, água, telefone e internet" })).toBeVisible();

  // Lançar de novo a partir do lançamento salvo
  await page.getByRole("link", { name: "Ver o lançamento" }).click();
  await page.getByRole("link", { name: "Lançar de novo" }).click();
  await expect(page.getByRole("heading", { name: "Lançar de novo" })).toBeVisible();
  await expect(page.locator("#l-desc")).toHaveValue(`Internet fibra E2E ${N}`);
  await expect(page.locator("#l-valor")).toHaveValue("89,90");
});

test("DRE personalizado: linha, conta levada, subtotal, esconder e ajuste no resultado", async ({ page }) => {
  test.setTimeout(240_000);
  const empresa = await entrar(page);
  await page.goto(`${empresa}/relatorios/dre/personalizar`);
  // Começa do padrão
  const voltar = page.getByRole("button", { name: "Voltar ao padrão" });
  if (await voltar.isVisible()) {
    await voltar.click();
    await page.getByRole("button", { name: "Voltar ao padrão" }).last().click();
    await expect(page.getByText("O DRE está no modelo padrão")).toBeVisible();
  }
  await page.getByRole("button", { name: "Personalizar o DRE" }).click();
  await expect(page.getByRole("button", { name: "Linha de contas" })).toBeVisible();

  // Linha nova logo abaixo do lucro bruto, com os salários
  await page.getByRole("button", { name: "Linha de contas" }).click();
  await page.fill("#nl-rotulo", "(−) Despesas com pessoal E2E");
  await page.selectOption("#nl-depois", await valorDaOpcao(page, "#nl-depois", "Lucro bruto"));
  await page.getByRole("button", { name: "Criar" }).click();
  const linha = page.getByRole("listitem", { name: "(−) Despesas com pessoal E2E" });
  await expect(linha).toBeVisible();
  await linha.getByRole("combobox", { name: /Trazer conta/ }).selectOption({ label: "4.01 Salários e encargos" });
  await expect(linha.getByText("4.01 Salários e encargos")).toBeVisible();

  // Subtotal e lucro bruto escondido
  await page.getByRole("button", { name: "Subtotal" }).click();
  await page.fill("#nl-rotulo", "Margem E2E");
  await page.selectOption("#nl-depois", await valorDaOpcao(page, "#nl-depois", "(−) Despesas com pessoal E2E"));
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("listitem", { name: "Margem E2E" })).toBeVisible();
  await page.getByRole("button", { name: "Editar Lucro bruto" }).click();
  await page.getByLabel("Mostrar este subtotal no relatório").uncheck();
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Linha atualizada.")).toBeVisible();
  // O resultado líquido não sobe nem desce
  await expect(page.getByRole("button", { name: "Subir Resultado líquido (lucro ou prejuízo)" })).toBeDisabled();

  // No DRE: o modelo da empresa
  await page.goto(`${empresa}/relatorios/dre?periodo=12m`);
  await expect(page.getByRole("link", { name: "Modelo do DRE" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Margem E2E" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Lucro bruto", exact: true })).toHaveCount(0);
  await expect(page.getByText("Linhas no modelo personalizado da empresa.")).toBeVisible();
  const pdf = await page.request.get(await page.getByRole("link", { name: "PDF" }).getAttribute("href") as string);
  expect(pdf.status()).toBe(200);

  // Ajuste no resultado: entra no DRE, com motivo, e pode ser excluído
  await page.getByRole("link", { name: "Ajustes" }).click();
  await page.selectOption("#aj-conta", await valorDaOpcao(page, "#aj-conta", "Manutenção e conservação"));
  await page.fill("#aj-valor", "250,00");
  await page.fill("#aj-motivo", `Depreciação E2E ${N}`);
  await page.getByRole("button", { name: "Lançar ajuste" }).click();
  await expect(page.getByRole("cell", { name: new RegExp(`^Depreciação E2E ${N}`) })).toBeVisible();
  await page.getByRole("button", { name: `Excluir ajuste Depreciação E2E ${N}` }).click();
  await page.getByRole("button", { name: "Excluir", exact: true }).last().click();
  await expect(page.getByRole("cell", { name: new RegExp(`^Depreciação E2E ${N}`) })).toHaveCount(0);

  // Volta ao padrão
  await page.goto(`${empresa}/relatorios/dre/personalizar`);
  await page.getByRole("button", { name: "Voltar ao padrão" }).click();
  await page.getByRole("button", { name: "Voltar ao padrão" }).last().click();
  await expect(page.getByText("O DRE está no modelo padrão")).toBeVisible();
});

test("celular: botão fixo para lançar despesa ou receita", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const empresa = await entrar(page);
  await page.goto(`${empresa}/financeiro/contas`);
  await page.getByRole("button", { name: "Lançar despesa ou receita" }).click();
  await page.getByRole("menuitem", { name: "Receita" }).click();
  await expect(page.getByRole("heading", { name: "Nova receita" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lançar despesa ou receita" })).toHaveCount(0);
});
