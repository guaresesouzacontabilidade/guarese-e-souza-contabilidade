import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Recibos de honorários: a equipe emite um recibo para a Padaria (publicado
 * nos documentos dela) e um avulso, baixa o PDF com o timbre, vê o valor do
 * último recibo já preenchido e cancela com motivo (o PDF sai dos documentos
 * do cliente). O cliente vê o recibo publicado, mas não a lista do
 * escritório. Dados fictícios da demonstração.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const PADARIA = "11222333000181";
const MARCA = "Teste automático (fictício)";

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
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

async function textoPdf(bytes: Buffer) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id").eq("documento", PADARIA).single();
  empresaId = data!.id;
});

test.afterAll(async () => {
  const { data: recibos } = await servico!.from("recibos_honorarios").select("id, documento_id").eq("observacao", MARCA);
  const docs = (recibos ?? []).map((r) => r.documento_id).filter(Boolean) as string[];
  if (recibos?.length) await servico!.from("recibos_honorarios").delete().in("id", recibos.map((r) => r.id));
  if (docs.length) {
    const { data: versoes } = await servico!.from("documento_versoes").select("storage_path").in("documento_id", docs);
    const caminhos = (versoes ?? []).map((v) => v.storage_path).filter(Boolean) as string[];
    if (caminhos.length) await servico!.storage.from("documentos").remove(caminhos);
    await servico!.from("documentos").delete().in("id", docs);
  }
});

test("equipe emite, baixa, publica e cancela recibos; o cliente só vê o publicado", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto("/escritorio/recibos");
  await expect(page.getByRole("heading", { name: "Recibos de honorários" })).toBeVisible();
  await expect(page.locator('a[href="/escritorio/recibos"]').first()).toBeAttached();

  // 1. Recibo para a Padaria, publicado nos documentos dela
  await page.getByRole("button", { name: "Novo recibo" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("button", { name: "Emitir recibo" }).click();
  await expect(dialogo.getByText("Escolha a empresa que pagou.")).toBeVisible();
  await dialogo.locator("#recibo-empresa").selectOption(empresaId);
  await dialogo.locator("#recibo-valor").fill("810,00");
  await dialogo.locator("#recibo-forma").selectOption("pix");
  await dialogo.getByText("Mais opções", { exact: false }).click();
  await dialogo.locator("#recibo-observacao").fill(MARCA);
  await expect(dialogo.locator('input[name="publicar"]')).toBeChecked();
  await dialogo.getByRole("button", { name: "Emitir recibo" }).click();
  await page.waitForURL(/\/escritorio\/recibos\?emitido=/, { timeout: 60_000 });
  const reciboId = new URL(page.url()).searchParams.get("emitido")!;
  const { data: r1 } = await servico!.from("recibos_honorarios").select("ano, numero, documento_id, pagador_nome, valor").eq("id", reciboId).single();
  const numero1 = `${String(r1!.numero).padStart(3, "0")}/${r1!.ano}`;
  await expect(page.getByText(`Recibo nº ${numero1} emitido`)).toBeVisible();
  await expect(page.getByText("O PDF já está nos documentos da empresa", { exact: false })).toBeVisible();
  expect(r1!.documento_id).toBeTruthy();
  expect(r1!.pagador_nome).toMatch(/^PADARIA PAO DOURADO LTDA/);
  expect(Number(r1!.valor)).toBe(810);
  const { data: doc } = await servico!.from("documentos").select("categoria_codigo, titulo, excluido_em").eq("id", r1!.documento_id!).single();
  expect(doc).toMatchObject({ categoria_codigo: "esc_recibo", excluido_em: null });
  expect(doc!.titulo).toContain(`Recibo nº ${numero1}`);

  // 2. PDF com o timbre, o valor por extenso e a forma de pagamento
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar o PDF", exact: true }).click()]);
  expect(arquivo.suggestedFilename()).toMatch(new RegExp(`^Recibo_${String(r1!.numero).padStart(3, "0")}_${r1!.ano}_Padaria_Pao_Dourado_.+\\.pdf$`));
  const texto = await textoPdf(readFileSync((await arquivo.path())!));
  expect(texto).toContain(`RECIBO Nº ${numero1}`);
  expect(texto).toContain("VALOR: R$ 810,00");
  expect(texto).toContain("PADARIA PAO DOURADO LTDA");
  expect(texto).toContain("R$ 810,00 (oitocentos e dez reais)");
  expect(texto).toContain("pago por PIX");
  expect(texto).toContain("firmamos o presente recibo");

  // 3. Recibo avulso (sem empresa no portal): número seguinte, sem publicar
  await page.getByRole("button", { name: "Novo recibo" }).click();
  await dialogo.getByText("Outra pessoa ou empresa").click();
  await expect(dialogo.locator('input[name="publicar"]')).toHaveCount(0);
  await dialogo.locator("#recibo-nome").fill("FULANO TESTE (FICTÍCIO)");
  await dialogo.locator("#recibo-doc").fill("111.111.111-11");
  await dialogo.locator("#recibo-valor").fill("150");
  await dialogo.getByText("Mais opções", { exact: false }).click();
  await dialogo.locator("#recibo-observacao").fill(MARCA);
  await dialogo.getByRole("button", { name: "Emitir recibo" }).click();
  await expect(dialogo.getByText("CPF ou CNPJ inválido.")).toBeVisible();
  await dialogo.locator("#recibo-doc").fill("529.982.247-25");
  await dialogo.getByRole("button", { name: "Emitir recibo" }).click();
  await page.waitForURL((u) => u.searchParams.get("emitido") !== reciboId && u.searchParams.has("emitido"), { timeout: 60_000 });
  const numero2 = `${String(r1!.numero + 1).padStart(3, "0")}/${r1!.ano}`;
  await expect(page.getByText(`Recibo nº ${numero2} emitido`)).toBeVisible();
  const linhaAvulso = page.getByRole("row", { name: new RegExp(numero2) });
  await expect(linhaAvulso.getByText("529.982.247-25")).toBeVisible();
  await expect(linhaAvulso.getByText("Emitido", { exact: true })).toBeVisible();
  await expect(linhaAvulso.getByRole("button", { name: "Publicar para o cliente" })).toHaveCount(0);

  // 4. Novo recibo da Padaria já vem com o valor do último
  await page.getByRole("button", { name: "Novo recibo" }).click();
  await dialogo.locator("#recibo-empresa").selectOption(empresaId);
  await expect(dialogo.locator("#recibo-valor")).toHaveValue("810,00");
  await expect(dialogo.getByText("Igual ao último recibo desta empresa.")).toBeVisible();
  await page.keyboard.press("Escape");

  // 5. O cliente vê o recibo nos documentos, mas não a lista nem o PDF do escritório
  const ctx = await browser.newContext({ locale: "pt-BR" });
  const cliente = await ctx.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto(`/e/${empresaId}/documentos?origem=escritorio`);
  await expect(cliente.getByText(`Recibo nº ${numero1}`, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  expect((await cliente.request.get(`/api/recibos/${reciboId}/pdf`)).status()).toBe(404);
  await cliente.goto("/escritorio/recibos");
  await expect(cliente).not.toHaveURL(/\/escritorio\/recibos/);
  await ctx.close();

  // 6. Cancelar com motivo: fica na lista, marcado; o PDF sai dos documentos do cliente
  const linha1 = page.getByRole("row", { name: new RegExp(numero1) });
  await linha1.getByRole("button", { name: "Cancelar" }).click();
  await dialogo.getByRole("button", { name: "Cancelar o recibo" }).click();
  await expect(dialogo.getByText("Informe o motivo (pelo menos 5 letras).")).toBeVisible();
  await dialogo.locator(`#motivo-recibo-${reciboId}`).fill("Valor digitado errado (teste)");
  await dialogo.getByRole("button", { name: "Cancelar o recibo" }).click();
  await expect(page.getByText("Recibo cancelado.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(linha1.getByText("Cancelado", { exact: true })).toBeVisible();
  const { data: docDepois } = await servico!.from("documentos").select("excluido_em").eq("id", r1!.documento_id!).single();
  expect(docDepois!.excluido_em).not.toBeNull();
  const cancelado = await textoPdf(Buffer.from(await (await page.request.get(`/api/recibos/${reciboId}/pdf`)).body()));
  expect(cancelado).toContain("CANCELADO");
  expect(cancelado).toContain("Valor digitado errado (teste)");
});
