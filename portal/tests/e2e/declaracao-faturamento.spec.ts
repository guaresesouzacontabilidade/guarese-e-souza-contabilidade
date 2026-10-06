import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Logo da empresa e declaração de faturamento: a equipe envia a logo no
 * cadastro, emite a declaração dos últimos 12 meses ajustando um valor e baixa
 * o PDF (com as logos); o empresário vê e envia a versão assinada; o
 * colaborador e outra empresa não acessam. Dados fictícios da demonstração.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const PADARIA = "11222333000181";

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

/** PNG fictício (faixas coloridas) para a logo da empresa. */
function pngTeste() {
  const w = 120;
  const h = 48;
  const linhas: number[] = [];
  for (let y = 0; y < h; y++) {
    linhas.push(0);
    for (let x = 0; x < w; x++) linhas.push(...((y >> 3) % 2 ? [30, 120, 60] : [240, 200, 40]));
  }
  const crcTabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTabela[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloco = (tipo: string, dados: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(t));
    return Buffer.concat([tam, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(Buffer.from(linhas))),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

/** PDF mínimo (sem assinatura digital), como um escaneado assinado à mão. */
const PDF_ASSINADO = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let empresaId = "";
let logoAntes: string | null = null;

test.beforeAll(async () => {
  const { data } = await servico!.from("empresas").select("id, logo_path").eq("documento", PADARIA).single();
  empresaId = data!.id;
  logoAntes = data!.logo_path;
});

test.afterAll(async () => {
  const { data: decls } = await servico!.from("declaracoes_faturamento").select("id, assinada_path").eq("empresa_id", empresaId).eq("contador_crc", "TO-E2E/O-0");
  const arquivos = (decls ?? []).map((d) => d.assinada_path).filter(Boolean) as string[];
  if (arquivos.length) await servico!.storage.from("declaracoes").remove(arquivos);
  if (decls?.length) await servico!.from("declaracoes_faturamento").delete().in("id", decls.map((d) => d.id));
  const { data: emp } = await servico!.from("empresas").select("logo_path").eq("id", empresaId).single();
  if (emp?.logo_path && emp.logo_path !== logoAntes) {
    await servico!.storage.from("empresas-logos").remove([emp.logo_path]);
    await servico!.from("empresas").update({ logo_path: logoAntes }).eq("id", empresaId);
  }
});

test("equipe envia a logo, emite a declaração dos últimos 12 meses e o empresário envia a assinada", async ({ page, browser }) => {
  // 1. Logo no cadastro da empresa
  await entrar(page, `contador@${DOMINIO}`);
  await page.goto(`/escritorio/empresas/${empresaId}`);
  await expect(page.getByText("Logo da empresa", { exact: true })).toBeVisible();
  await page.setInputFiles("#empresa-logo", { name: "logo-padaria.png", mimeType: "image/png", buffer: pngTeste() });
  await page.getByRole("button", { name: "Enviar logo" }).click();
  await expect(page.getByText("Logo da empresa atualizada.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: "Logo atual da empresa" })).toBeVisible();

  // 2. Nova declaração: 12 meses preenchidos de uma vez; um valor ajustado à mão
  await page.goto(`/e/${empresaId}/declaracoes`);
  await page.getByRole("link", { name: "Nova declaração de faturamento" }).click();
  await expect(page.getByRole("heading", { name: "Nova declaração de faturamento" })).toBeVisible();
  const campos = page.locator('input[name="valor"]');
  await expect(campos).toHaveCount(12);
  await expect(page.getByText("Logo do cadastro", { exact: false })).toBeVisible();
  await campos.first().fill("12.345,67");
  await expect(page.getByText("valor digitado").first()).toBeVisible();
  await page.fill("#dec-rep-nome", "MARIA TESTE (FICTÍCIA)");
  await page.fill("#dec-rep-cpf", "529.982.247-25");
  await page.fill("#dec-cont-nome", "CONTADOR TESTE (FICTÍCIO)");
  await page.fill("#dec-cont-crc", "TO-E2E/O-0");
  await page.fill("#dec-finalidade", "comprovação de faturamento junto a instituição financeira");
  await page.getByRole("button", { name: "Emitir declaração" }).click();
  await page.waitForURL(/\/declaracoes\?emitida=/, { timeout: 60_000 });
  await expect(page.getByText("Declaração emitida", { exact: true })).toBeVisible();
  const { data: decl } = await servico!.from("declaracoes_faturamento").select("id, total, meses").eq("empresa_id", empresaId).eq("contador_crc", "TO-E2E/O-0").single();
  const meses = decl!.meses as { competencia: string; valor: number; origem: string }[];
  expect(meses).toHaveLength(12);
  expect(meses[0]).toMatchObject({ valor: 12345.67, origem: "digitado" });

  // 3. PDF para assinar: texto da declaração, total e a logo da empresa embutida
  const linha = page.locator("li", { hasText: "Aguardando assinaturas" }).first();
  const [arquivo] = await Promise.all([page.waitForEvent("download"), linha.getByRole("link", { name: "PDF para assinar" }).click()]);
  expect(arquivo.suggestedFilename()).toMatch(/^declaracao-faturamento-padaria.*\.pdf$/);
  const bytes = readFileSync((await arquivo.path())!);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  expect(text).toContain("DECLARAÇÃO DE FATURAMENTO");
  expect(text).toContain("PADARIA PAO DOURADO LTDA");
  expect(text).toContain("R$ 12.345,67");
  expect(text).toContain("Total do período");
  expect(text).toContain("MARIA TESTE (FICTÍCIA)");
  expect(text).toContain("CRC TO-E2E/O-0");
  expect(text).toContain("comprovação de faturamento junto a instituição financeira");
  expect(bytes.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);

  // 4. O empresário vê a declaração e envia a versão assinada
  const ctx = await browser.newContext({ locale: "pt-BR" });
  const cliente = await ctx.newPage();
  await entrar(cliente, `cliente@${DOMINIO}`);
  await cliente.goto(`/e/${empresaId}/declaracoes`);
  await expect(cliente.getByRole("link", { name: "Nova declaração de faturamento" })).toHaveCount(0);
  const linhaCliente = cliente.locator("li", { hasText: "Aguardando assinaturas" }).first();
  await linhaCliente.getByRole("button", { name: "Enviar a assinada" }).click();
  await cliente.setInputFiles('input[name="arquivo"]', { name: "declaracao-assinada.pdf", mimeType: "application/pdf", buffer: PDF_ASSINADO });
  await cliente.getByRole("dialog").getByRole("button", { name: "Enviar" }).click();
  await expect(cliente.getByText(/Declaração assinada guardada\. O PDF não tem assinatura digital/)).toBeVisible({ timeout: 30_000 });
  await expect(cliente.getByText("sem assinatura digital", { exact: false }).first()).toBeVisible();
  const baixada = await cliente.request.get(`/api/declaracoes/${decl!.id}/assinada`);
  expect(baixada.status()).toBe(200);
  expect((await baixada.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await ctx.close();

  // 5. Outra empresa e o colaborador não acessam
  const ctx2 = await browser.newContext({ locale: "pt-BR" });
  const outro = await ctx2.newPage();
  await entrar(outro, `cliente2@${DOMINIO}`);
  expect((await outro.request.get(`/api/declaracoes/${decl!.id}/pdf`)).status()).toBe(404);
  expect((await outro.request.get(`/api/declaracoes/${decl!.id}/assinada`)).status()).toBe(404);
  await ctx2.close();
  const ctx3 = await browser.newContext({ locale: "pt-BR" });
  const colaborador = await ctx3.newPage();
  await entrar(colaborador, `colaborador@${DOMINIO}`);
  await colaborador.goto(`/e/${empresaId}/declaracoes`);
  await expect(colaborador.getByText("Seu acesso não inclui as declarações desta empresa.")).toBeVisible();
  await ctx3.close();
});
