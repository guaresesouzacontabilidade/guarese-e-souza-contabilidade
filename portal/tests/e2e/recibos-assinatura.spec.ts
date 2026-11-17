import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Recibo assinado digitalmente: o administrador cadastra o certificado A1 do
 * escritório (aqui, um certificado de teste fictício com o CNPJ do
 * escritório), emite um recibo e o PDF sai assinado (PAdES) e guardado; a
 * equipe vê o selo "Assinado". Sem certificado, nada é assinado.
 */
const SENHA = process.env.DEMO_SENHA ?? "Demo-Teste-2026!";
const DOMINIO = "demo.guareses.test";
const MARCA = "Teste automático de assinatura (fictício)";
const SENHA_PFX = "senha-do-teste";

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

/** Arquivo .pfx de teste (autoassinado, fictício) com o CNPJ do escritório no nome. */
function pfxDeTeste(cnpj: string): Buffer {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chave = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  cert.serialNumber = "01a2b3c4";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [
    { name: "commonName", value: `ESCRITORIO TESTE FICTICIO:${cnpj}` },
    { name: "countryName", value: "BR" },
  ];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chave, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chave, [cert], SENHA_PFX, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

const servico = clienteServico();
test.skip(!servico || !process.env.CERTIFICADOS_CHAVE, "Precisa do Supabase local e da CERTIFICADOS_CHAVE (.env.local).");

async function limpar() {
  const { data: recibos } = await servico!.from("recibos_honorarios").select("id, arquivo_path").eq("observacao", MARCA);
  const arquivos = (recibos ?? []).map((r) => r.arquivo_path).filter(Boolean) as string[];
  if (arquivos.length) await servico!.storage.from("recibos").remove(arquivos);
  if (recibos?.length) await servico!.from("recibos_honorarios").delete().in("id", recibos.map((r) => r.id));
  await servico!.from("escritorio_certificado").delete().eq("id", 1);
}

test.beforeAll(limpar);
test.afterAll(limpar);

test("administrador cadastra o certificado e o recibo sai assinado digitalmente", async ({ page }) => {
  test.setTimeout(240_000);
  const { data: esc } = await servico!.from("escritorio").select("cnpj").eq("id", 1).single();
  const pfx = pfxDeTeste(esc!.cnpj.replace(/\D/g, ""));

  await entrar(page, `admin@${DOMINIO}`);

  // 1. Sem certificado: os recibos saem sem assinatura
  await page.goto("/escritorio/recibos");
  await expect(page.getByText("recibos saem sem assinatura digital", { exact: false })).toBeVisible();
  await emitirAvulso(page, "ANTES DO CERTIFICADO (FICTÍCIO)", "100,00");
  await expect(page.getByText(/Recibo nº \d+\/\d{4} emitido$/)).toBeVisible();
  const antesId = new URL(page.url()).searchParams.get("emitido")!;

  // 2. Cadastro em Configurações › Integrações (senha errada primeiro)
  await page.goto("/escritorio/configuracoes?aba=integracoes");
  await expect(page.getByText("Assinatura digital dos recibos (certificado do escritório)")).toBeVisible();
  await expect(page.getByText("Desconectada até o cadastro do certificado", { exact: false })).toBeVisible();
  await page.setInputFiles("#cert-escritorio-arquivo", { name: "escritorio-teste.pfx", mimeType: "application/x-pkcs12", buffer: pfx });
  await page.fill("#cert-escritorio-senha", "senha-errada");
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText("Senha do certificado incorreta.").first()).toBeVisible({ timeout: 30_000 });
  await page.setInputFiles("#cert-escritorio-arquivo", { name: "escritorio-teste.pfx", mimeType: "application/x-pkcs12", buffer: pfx });
  await page.fill("#cert-escritorio-senha", SENHA_PFX);
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page.getByText("Certificado cadastrado.", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`ESCRITORIO TESTE FICTICIO:`, { exact: false }).first()).toBeVisible();

  // 3. Recibo avulso: emitido e assinado
  await page.goto("/escritorio/recibos");
  await expect(page.getByText("assinados digitalmente", { exact: false }).first()).toBeVisible();
  await emitirAvulso(page, "CLIENTE ASSINATURA (FICTÍCIO)", "320,00");
  await expect(page.getByText(/emitido e assinado digitalmente/)).toBeVisible();
  const reciboId = new URL(page.url()).searchParams.get("emitido")!;
  const { data: r } = await servico!.from("recibos_honorarios").select("arquivo_path, assinatura_documento").eq("id", reciboId).single();
  expect(r!.arquivo_path).toMatch(/^\d{4}\/[0-9a-f-]{36}\.pdf$/);
  await expect(page.locator('[title="Assinado digitalmente (ICP-Brasil)"]:visible').first()).toBeVisible();

  // 4. O PDF baixado é o arquivo assinado: assinatura válida cobrindo o documento inteiro
  const [arquivo] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar o PDF", exact: true }).click()]);
  const bytes = readFileSync((await arquivo.path())!);
  expect(bytes.toString("latin1")).toContain("/SubFilter /ETSI.CAdES.detached");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  expect(text.replace(/\s+/g, " ")).toContain("Documento assinado digitalmente ESCRITORIO TESTE FICTICIO");
  const guardado = await servico!.storage.from("recibos").download(r!.arquivo_path!);
  expect(Buffer.from(await guardado.data!.arrayBuffer()).equals(bytes)).toBe(true);
  if (existsSync("/usr/bin/pdfsig")) {
    const caminho = join(tmpdir(), `recibo-assinado-${reciboId}.pdf`);
    writeFileSync(caminho, bytes);
    const saida = execFileSync("/usr/bin/pdfsig", [caminho], { encoding: "utf8" });
    expect(saida).toContain("Signature is Valid");
    expect(saida).toContain("Total document signed");
  }

  // 5. O recibo emitido antes do certificado é assinado pelo botão "Assinar"
  const linhaAntes = page.getByRole("row").filter({ hasText: "ANTES DO CERTIFICADO" });
  await linhaAntes.getByRole("button", { name: "Assinar", exact: true }).click();
  await expect(page.getByText(/assinado digitalmente\./).first()).toBeVisible({ timeout: 30_000 });
  await expect(linhaAntes.locator('[title="Assinado digitalmente (ICP-Brasil)"]')).toBeVisible();
  const { data: antes } = await servico!.from("recibos_honorarios").select("arquivo_path").eq("id", antesId).single();
  expect(antes!.arquivo_path).toBeTruthy();

  // 6. "Assinar de novo" gera outro arquivo assinado e apaga o anterior
  await linhaAntes.getByRole("button", { name: "Assinar de novo" }).click();
  await page.getByRole("button", { name: "Assinar de novo" }).last().click();
  await expect(async () => {
    const { data: depois } = await servico!.from("recibos_honorarios").select("arquivo_path").eq("id", antesId).single();
    expect(depois!.arquivo_path).not.toBe(antes!.arquivo_path);
    expect(depois!.arquivo_path).toMatch(/-\d+\.pdf$/);
  }).toPass({ timeout: 30_000 });
  const { data: velho } = await servico!.storage.from("recibos").download(antes!.arquivo_path!);
  expect(velho).toBeNull();
});

async function emitirAvulso(page: Page, nome: string, valor: string) {
  const anterior = new URL(page.url()).searchParams.get("emitido");
  await page.getByRole("button", { name: "Novo recibo" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByText("Outra pessoa ou empresa").click();
  await dialogo.locator("#recibo-nome").fill(nome);
  await dialogo.locator("#recibo-valor").fill(valor);
  await dialogo.getByText("Mais opções", { exact: false }).click();
  await dialogo.locator("#recibo-observacao").fill(MARCA);
  await dialogo.getByRole("button", { name: "Emitir recibo" }).click();
  await page.waitForURL((u) => u.searchParams.has("emitido") && u.searchParams.get("emitido") !== anterior, { timeout: 60_000 });
}
