import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Gerador da EFD ICMS/IPI (dados fictícios da demonstração): na Oficina (Lucro
 * Presumido, TO), a equipe atualiza a leitura das notas do mês, informa o
 * código de receita do ICMS, gera o arquivo e baixa. O empresário não abre a
 * tela nem baixa o arquivo.
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
let competencia = "";

async function limpar() {
  if (!empresaId) return;
  const { data } = await servico!.from("efd_geracoes").select("storage_path").eq("empresa_id", empresaId).eq("competencia", competencia);
  if (data?.length) await servico!.storage.from("efd").remove(data.map((g) => g.storage_path));
  await servico!.from("efd_geracoes").delete().eq("empresa_id", empresaId).eq("competencia", competencia);
  await servico!.from("efd_configuracoes").delete().eq("empresa_id", empresaId);
}

test.beforeAll(async () => {
  const { data: emp } = await servico!.from("empresas").select("id").like("razao_social", "OFICINA MECANICA EXEMPLO%").single();
  empresaId = emp!.id;
  const { data } = await servico!
    .from("documentos_fiscais")
    .select("competencia")
    .eq("empresa_id", empresaId)
    .eq("modelo", "55")
    .eq("operacao", "saida")
    .order("competencia", { ascending: false })
    .limit(1);
  competencia = data?.[0]?.competencia ?? "";
  await limpar();
});

test.afterAll(limpar);

test.describe.configure({ mode: "serial" });

test("equipe gera a EFD do mês, com a releitura das notas e o código de receita, e baixa o arquivo", async ({ page }) => {
  test.skip(!competencia, "Rode o seed da demonstração (notas da Oficina).");
  test.setTimeout(180_000);
  const url = `/e/${empresaId}/calculos/efd?competencia=${competencia.slice(0, 7)}`;
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "EFD ICMS/IPI (SPED Fiscal)", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "EFD ICMS/IPI", exact: true })).toHaveAttribute("aria-current", "page");

  // Notas lidas antes da versão da EFD: relê os XML guardados
  const reler = page.getByRole("button", { name: "Atualizar a leitura das notas" });
  if (await reler.isVisible()) {
    await reler.click();
    await expect(page.getByText(/Releitura de \d+ nota|já estão com a leitura atual/)).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("button", { name: "Atualizar a leitura das notas" })).toHaveCount(0);
      await expect(page.getByText(/Atualizando a leitura de/)).toHaveCount(0);
    }).toPass({ timeout: 90_000, intervals: [2_000, 4_000] });
  }

  // Código de receita do ICMS (fica guardado para os próximos meses)
  await page.getByLabel("Código de receita do ICMS").fill("9999");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText("Configuração da EFD salva.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Código de receita do ICMS")).toHaveValue("9999");
  await expect(page.getByText("Informe o código de receita do ICMS")).toHaveCount(0);

  // Prévia da apuração e geração
  await expect(page.getByText("Prévia da apuração (registro E110)")).toBeVisible();
  const vencimento = page.getByLabel("Vencimento do ICMS a recolher");
  if ((await vencimento.count()) && !(await vencimento.inputValue())) await vencimento.fill(`${competencia.slice(0, 4)}-${competencia.slice(5, 7) === "12" ? "01" : String(Number(competencia.slice(5, 7)) + 1).padStart(2, "0")}-15`);
  for (const caixa of await page.locator('input[name="confirmar"]').all()) await caixa.check();
  await page.getByRole("button", { name: "Gerar arquivo da EFD" }).click();
  await expect(page.getByText(/Arquivo gerado: \d+ linhas/)).toBeVisible({ timeout: 30_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar o arquivo gerado", exact: true }).click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/^EFD-ICMS-IPI_\d{14}_\d{6}\.txt$/);
  const texto = readFileSync((await arquivo.path())!, "latin1");
  const [aaaa, mm] = [competencia.slice(0, 4), competencia.slice(5, 7)];
  expect(texto.startsWith(`|0000|020|0|01${mm}${aaaa}|`)).toBe(true);
  expect(texto).toContain("|0100|CONTADORA DE DEMONSTRAÇÃO|52998224725|");
  expect(texto).toMatch(/\|C100\|1\|0\|/);
  expect(texto.trimEnd().split("\r\n").at(-1)).toMatch(/^\|9999\|\d+\|$/);

  // Histórico do mês
  await page.reload();
  await expect(page.getByRole("link", { name: /Baixar o arquivo gerado em/ })).toHaveCount(1);
});

test("empresário não abre a EFD nem baixa o arquivo", async ({ page }) => {
  test.skip(!competencia, "Rode o seed da demonstração (notas da Oficina).");
  const { data: g } = await servico!.from("efd_geracoes").select("id").eq("empresa_id", empresaId).limit(1).maybeSingle();
  await entrar(page, `cliente2@${DOMINIO}`);
  await page.goto(`/e/${empresaId}/calculos/efd`);
  await expect(page.getByText("A EFD ICMS/IPI é gerada pela equipe do escritório.")).toBeVisible();
  if (g) {
    const r = await page.request.get(`/api/efd/${empresaId}/${g.id}`);
    expect(r.status()).toBe(403);
  }
});
