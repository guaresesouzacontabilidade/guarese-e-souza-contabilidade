import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Relatório de correções do auditor fiscal: a equipe refaz a análise da
 * Padaria de demonstração (notas fictícias), escolhe os achados, baixa a
 * planilha (produtos com o código fiscal certo) e o PDF e publica os dois em
 * Documentos; o empresário vê o relatório, mas não consegue gerá-lo pelo
 * endereço da equipe. No fim, os documentos publicados saem da demonstração.
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
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
const inicio = new Date().toISOString();

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").like("razao_social", "PADARIA PAO DOURADO%").maybeSingle();
  empresaId = emp?.id ?? "";
});

test.afterAll(async () => {
  if (!empresaId) return;
  // Tira da demonstração os relatórios publicados pelo teste
  await servico!
    .from("documentos")
    .update({ excluido_em: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .eq("categoria_codigo", "esc_relatorio")
    .like("titulo", "Relatório de correções fiscais%")
    .is("excluido_em", null);
});

test("equipe baixa e publica o relatório de correções; o cliente vê em Documentos", async ({ browser }) => {
  test.setTimeout(300_000);
  test.skip(!empresaId, "Rode `npm run seed:demo` (Padaria de demonstração).");
  const ctxEquipe = await browser.newContext({ locale: "pt-BR", acceptDownloads: true });
  const equipe = await ctxEquipe.newPage();
  await entrar(equipe, `contador@${DOMINIO}`);
  await equipe.goto(`/e/${empresaId}/auditor-fiscal`);
  await expect(equipe.getByRole("heading", { name: "Auditor fiscal" })).toBeVisible();

  // Análise nova: grava os grupos de itens de cada achado (base da lista de produtos)
  const analisar = equipe.getByRole("button", { name: "Analisar agora" });
  if (await analisar.isEnabled().catch(() => false)) await analisar.click();
  await expect
    .poll(
      async () => {
        const { data } = await servico!
          .from("auditor_execucoes")
          .select("situacao, criada_em")
          .eq("empresa_id", empresaId)
          .order("criada_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data?.situacao === "concluida" && data.criada_em >= inicio;
      },
      { timeout: 180_000, intervals: [3_000] },
    )
    .toBe(true);
  await equipe.reload();

  await equipe.getByRole("button", { name: "Relatório de correções para o cliente" }).click();
  const lista = equipe.getByRole("list", { name: "Achados do relatório" });
  await expect(lista).toBeVisible();
  await equipe.getByRole("button", { name: "Só oportunidades" }).click();
  await expect(equipe.getByText(/^\d+ achados? escolhidos? · possível economia/)).toBeVisible();
  await equipe.getByLabel("Recado do escritório (opcional)").fill("Ajustem o cadastro destes produtos, por favor.");

  // Planilha: produtos com o código fiscal certo
  const [planilha] = await Promise.all([equipe.waitForEvent("download"), equipe.getByRole("link", { name: "Baixar planilha" }).click()]);
  expect(planilha.suggestedFilename()).toMatch(/^correcoes-fiscais-.*\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await planilha.path());
  const produtos: string[][] = [];
  wb.getWorksheet("Produtos a corrigir")!.eachRow((r) => produtos.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
  expect(produtos.some((l) => /monofásico|ICMS-ST/i.test(l[0] ?? "") && (l[11] ?? "").length > 0)).toBe(true);

  // PDF
  const [pdf] = await Promise.all([equipe.waitForEvent("download"), equipe.getByRole("link", { name: "Baixar PDF" }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(readFileSync(await pdf.path()).subarray(0, 4).toString()).toBe("%PDF");

  // Publicar ao cliente
  await equipe.getByRole("button", { name: "Publicar para o cliente" }).click();
  await equipe.getByRole("button", { name: "Confirmar e publicar" }).click();
  await expect(equipe.getByText(/Relatório publicado: o PDF e a planilha estão em Documentos/)).toBeVisible({ timeout: 60_000 });
  const url = equipe.url();

  // O empresário vê o relatório em Documentos, mas não gera pelo endereço da equipe
  const ctxCliente = await browser.newContext({ locale: "pt-BR" });
  const cliente = await ctxCliente.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto(`/e/${empresaId}/documentos?origem=escritorio&categoria=esc_relatorio`);
  await expect(cliente.getByText(/Relatório de correções fiscais/).first()).toBeVisible({ timeout: 30_000 });
  const ids = new URL((await equipe.getByRole("link", { name: "Baixar PDF" }).getAttribute("href"))!, url).searchParams.get("ids")!;
  const negado = await cliente.request.get(`/api/auditor/${empresaId}/relatorio?ids=${ids}&formato=pdf`);
  expect(negado.status()).toBe(403);

  await ctxEquipe.close();
  await ctxCliente.close();
});
