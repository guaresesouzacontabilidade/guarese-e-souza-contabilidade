import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Importar o relatório de contas a pagar em PDF (fictício, gerado pelos testes
 * no leiaute dos sistemas de gestão de lojas): o cliente envia o PDF como
 * "Relatório de contas a pagar e a receber", abre a importação, vê a conferência
 * com o resumo do relatório e a prévia (datas, valores e parcelas), importa e as
 * contas entram como lançamentos a pagar para revisar. Desfaz no fim.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";

function clienteServico(): SupabaseClient | null {
  try {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* sem .env.local */
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
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

test("cliente importa o relatório de contas a pagar em PDF com as datas e os valores", async ({ page }) => {
  test.setTimeout(240_000);
  await entrar(page, `cliente@${DOMINIO}`);
  await page.waitForURL(/\/e\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const empresa = page.url().match(/\/e\/([0-9a-f-]{36})/)![1];

  // Desfaz importações de testes anteriores interrompidos (senão as contas já existem e nada entra de novo)
  await page.goto(`/e/${empresa}/financeiro/importar`);
  for (let i = 0; i < 5; i++) {
    const sobra = page.getByRole("row").filter({ hasText: /contas-a-pagar-\d+\.pdf/ }).filter({ has: page.getByRole("button", { name: "Desfazer importação" }) }).first();
    if (!(await sobra.count())) break;
    await sobra.getByRole("button", { name: "Desfazer importação" }).click();
    await page.getByLabel("Motivo").fill("Teste automático (E2E) interrompido");
    await page.getByRole("button", { name: "Desfazer", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
    await page.reload();
  }

  // Data de início do contas a pagar: salva e tira (a demonstração fica como estava)
  await page.getByLabel("Contas a pagar no portal a partir de").fill("2026-11-26");
  await page.getByRole("button", { name: "Salvar data" }).click();
  await expect(page.getByText("Contas a pagar no portal a partir de 26/11/2026.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Tirar a data" }).click();
  await expect(page.getByText("Sem data de início: todas as contas a pagar entram.")).toBeVisible({ timeout: 30_000 });

  // Envia o PDF (conteúdo único: o portal recusa arquivo idêntico já enviado)
  await page.getByRole("link", { name: "Enviar relatório de contas" }).click();
  await page.waitForURL(/\/enviar\?categoria=relatorio_contas/);
  const pasta = mkdtempSync(join(tmpdir(), "relatorio-contas-"));
  const nome = `contas-a-pagar-${Date.now()}.pdf`;
  const arquivo = join(pasta, nome);
  writeFileSync(arquivo, Buffer.concat([readFileSync("tests/fixtures/relatorio-contas-pagar-ficticio.pdf"), Buffer.from(`\n% teste ${Date.now()}\n`)]));
  await page.setInputFiles('input[aria-label="Escolher arquivos"]', arquivo);
  await page.getByRole("button", { name: /Enviar \d+ arquivo/ }).click();
  await expect(page.getByText(/documento\(s\) recebido\(s\)/).first()).toBeVisible({ timeout: 60_000 });

  // Abre a importação do arquivo enviado
  await page.goto(`/e/${empresa}/financeiro/importar`);
  const item = page.getByRole("listitem").filter({ hasText: nome });
  await item.getByRole("link", { name: "Importar" }).click();
  await expect(page.getByText("Confere com o resumo do relatório")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Relatório de contas a pagar em PDF/)).toBeVisible();
  // Prévia: as 26 contas fictícias, com a parcela, a data e o valor
  await expect(page.getByRole("button", { name: "Importar 26 lançamento(s)" })).toBeEnabled({ timeout: 60_000 });
  const pinus = page.getByRole("row", { name: /TORAS DE PINUS FORNECEDOR TESTE \(2\/6\)/ });
  await expect(pinus).toContainText("25/02/2027");
  await expect(pinus).toContainText("R$ 8.450,00");
  await expect(page.getByRole("row", { name: /FRETE TORAS TESTE/ })).toContainText("TRANSPORTADORA FICTICIA LTDA");
  // Só a partir de uma data: as anteriores ficam de fora; "todas as datas" volta tudo
  await page.getByLabel("Só contas com vencimento a partir de").fill("2027-03-01");
  await expect(page.getByRole("button", { name: "Importar 14 lançamento(s)" })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByText(/12 conta\(s\) ficam de fora/)).toBeVisible();
  await page.getByRole("button", { name: "Importar todas as datas" }).click();
  await expect(page.getByRole("button", { name: "Importar 26 lançamento(s)" })).toBeEnabled({ timeout: 60_000 });

  await page.getByRole("button", { name: "Importar 26 lançamento(s)" }).click();
  await expect(page.getByText("Importação concluída")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/26 lançamento\(s\) importado\(s\)/)).toBeVisible();

  // No banco: contas a pagar com as datas e os valores, para revisar
  const { data: doc } = await servico!.from("documentos").select("id").eq("empresa_id", empresa).eq("nome_original", nome).single();
  const { data: imp } = await servico!.from("importacoes").select("id, total_novas").eq("documento_id", doc!.id).single();
  expect(imp!.total_novas).toBe(26);
  const { data: lancs } = await servico!.from("lancamentos").select("tipo, descricao, data_vencimento, valor_previsto, status_revisao").eq("importacao_id", imp!.id);
  expect(lancs).toHaveLength(26);
  expect(lancs!.every((l) => l.tipo === "pagar" && l.status_revisao === "sugerido")).toBe(true);
  const p2 = lancs!.find((l) => l.descricao === "TORAS DE PINUS FORNECEDOR TESTE (2/6)")!;
  expect([p2.data_vencimento, Number(p2.valor_previsto)]).toEqual(["2027-02-25", 8450]);

  // Desfaz (deixa a demonstração como estava)
  await page.goto(`/e/${empresa}/financeiro/importar`);
  const linhaImp = page.getByRole("row").filter({ hasText: nome });
  await linhaImp.getByRole("button", { name: "Desfazer importação" }).click();
  await page.getByLabel("Motivo").fill("Teste automático (E2E)");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => (await servico!.from("lancamentos").select("id", { count: "exact", head: true }).eq("importacao_id", imp!.id)).count, { timeout: 30_000 })
    .toBe(0);
});
