import { test, expect, type Page } from "@playwright/test";

/**
 * Camada operacional (somente equipe): telas principais, conclusão de tarefa
 * exige comprovante e validação de normas só pelo administrador.
 * Usa os usuários fictícios criados por `npm run seed:demo`.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

async function entrarEquipe(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

test("equipe usa a camada operacional; validação de normas é do administrador", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  await entrarEquipe(page, `contador@${DOMINIO}`);

  const telas: [string, string][] = [
    ["/escritorio/obrigacoes", "Obrigações e prazos"],
    ["/escritorio/obrigacoes/tarefas", "Tarefas"],
    ["/escritorio/obrigacoes/agenda", "Agenda"],
    ["/escritorio/obrigacoes/empresas", "Tabela operacional"],
    ["/escritorio/obrigacoes/catalogo", "Catálogo de obrigações"],
    ["/escritorio/obrigacoes/normas", "Atualizações normativas"],
    ["/escritorio/obrigacoes/feriados", "Feriados"],
  ];
  for (const [rota, titulo] of telas) {
    const r = await page.goto(rota);
    expect(r?.status(), rota).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: titulo })).toBeVisible();
  }

  // Ordem padrão por razão social; opção por urgência
  await page.goto("/escritorio/obrigacoes/empresas?ordem=urgencia");
  await expect(page.getByRole("link", { name: "Urgência de prazo" })).toHaveAttribute("aria-current", "true");

  // Equipe não valida nem aplica normas
  await page.goto("/escritorio/obrigacoes/normas");
  await expect(page.getByRole("button", { name: "Validar" })).toHaveCount(0);

  // Pagamento não é marcado como pago sem comprovante
  await page.goto("/escritorio/obrigacoes/tarefas?etapa=pagamento");
  const tarefa = page.locator("tbody tr a[href*='/escritorio/obrigacoes/tarefas/']").first();
  if (await tarefa.count()) {
    await page.goto((await tarefa.getAttribute("href"))!);
    const pagar = page.getByRole("button", { name: "Marcar como paga" });
    if (await pagar.count()) {
      await page.selectOption("#comprovante", "");
      await pagar.click();
      await expect(page.getByText("Escolha ou envie o comprovante de pagamento antes de concluir.")).toBeVisible();
    }
  }
  expect(erros, erros.join("\n")).toHaveLength(0);
});
