import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Verificação em duas etapas uma vez por dia (usuário fictício criado só para o teste):
 *  - ao confirmar o código com "Não pedir o código de novo hoje" marcado, fechar
 *    e abrir o portal pede só a senha (a sessão fica travada até lá); senha
 *    errada conta tentativas;
 *  - sem a opção marcada, fechar o portal encerra a sessão (volta ao login).
 */
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";
const SENHA = `Teste-${randomInt(100000, 999999)}-Ab1`;
const EMAIL = `e2e-2fa-${randomInt(100000, 999999)}@demo.guareses.test`;

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

/** Código TOTP (RFC 6238, 30 s, 6 dígitos) a partir da chave mostrada no cadastro. */
function codigoTotp(segredo: string, instante = Date.now()) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...segredo.replace(/=+$/, "").toUpperCase()].map((c) => alfabeto.indexOf(c).toString(2).padStart(5, "0")).join("");
  const chave = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(instante / 30000)));
  const h = createHmac("sha1", chave).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(n).padStart(6, "0");
}

/** Espera a próxima janela de 30 s (o mesmo código não vale duas vezes). */
async function proximaJanela(page: Page) {
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 500);
}

async function entrar(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="senha"]', SENHA);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => /^\/(aceite|e\/|escritorio|conta|painel|mfa)/.test(u.pathname), { timeout: 90_000 });
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }
}

/** "Fecha o portal": abre outro navegador com os mesmos cookies, menos o sinal de portal aberto. */
async function fecharEAbrir(browser: Browser, contexto: BrowserContext) {
  const cookies = (await contexto.cookies()).filter((c) => c.name !== "portal_aberto");
  await contexto.close();
  const novo = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  await novo.addCookies(cookies);
  return novo;
}

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");
test.describe.configure({ mode: "serial" });

let usuarioId = "";
let segredo = "";

test.beforeAll(async () => {
  const { data, error } = await servico!.auth.admin.createUser({
    email: EMAIL,
    password: SENHA,
    email_confirm: true,
    app_metadata: { tipo: "cliente" },
    user_metadata: { nome: "Teste Duas Etapas (E2E)" },
  });
  if (error) throw new Error(error.message);
  usuarioId = data.user.id;
});

test.afterAll(async () => {
  if (usuarioId) await servico!.auth.admin.deleteUser(usuarioId);
});

test("com a opção marcada, fechar e abrir o portal no mesmo dia pede só a senha", async ({ browser }) => {
  test.setTimeout(180_000);
  const contexto = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const page = await contexto.newPage();
  await entrar(page);
  // Usuário novo: aceita os termos antes de tudo
  await page.goto("/painel");
  if (page.url().includes("/aceite")) {
    for (const b of await page.locator('input[type="checkbox"]').all()) await b.check();
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/aceite"), { timeout: 90_000 });
  }

  // Cadastra o aplicativo autenticador (a chave aparece abaixo do QR Code)
  await page.goto("/mfa/cadastrar?proximo=/conta");
  segredo = (await page.locator("code").first().innerText()).trim();
  expect(segredo).toMatch(/^[A-Z2-7]{16,}$/);
  await expect(page.getByLabel("Não pedir o código de novo hoje neste aparelho")).toBeChecked();
  await page.getByLabel("Código de 6 dígitos").fill(codigoTotp(segredo));
  await page.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
  await page.waitForURL((u) => u.pathname === "/conta", { timeout: 60_000 });
  await expect.poll(async () => (await servico!.from("sessoes_portal").select("session_id").eq("user_id", usuarioId)).data?.length ?? 0).toBe(1);

  // Fecha o portal e abre de novo: tela de senha, sem o código
  const reaberto = await fecharEAbrir(browser, contexto);
  const p2 = await reaberto.newPage();
  await p2.goto("/conta");
  await p2.waitForURL(/\/desbloquear/, { timeout: 60_000 });
  await expect(p2.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
  await expect(p2.getByText(EMAIL)).toBeVisible();
  const { data: travada } = await servico!.from("sessoes_portal").select("bloqueada_em").eq("user_id", usuarioId).single();
  expect(travada!.bloqueada_em).not.toBeNull();

  // Travada, outra tela do portal também volta para a senha
  await p2.goto("/painel");
  await p2.waitForURL(/\/desbloquear/, { timeout: 60_000 });

  // Senha errada conta tentativa; a certa libera sem pedir o código
  await p2.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
  await p2.getByRole("button", { name: "Continuar" }).click();
  await expect(p2.getByText(/Senha incorreta\. Restam 4 tentativas/)).toBeVisible({ timeout: 30_000 });
  await p2.getByLabel("Senha", { exact: true }).fill(SENHA);
  await p2.getByRole("button", { name: "Continuar" }).click();
  await p2.waitForURL((u) => !u.pathname.startsWith("/desbloquear") && !u.pathname.startsWith("/mfa") && !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await p2.goto("/conta");
  await expect(p2).toHaveURL(/\/conta/);
  await expect(p2.getByText("Ativada", { exact: true })).toBeVisible();
  await reaberto.close();
});

test("sem a opção, fechar o portal encerra a sessão (próximo acesso pede senha e código)", async ({ browser }) => {
  test.setTimeout(180_000);
  const contexto = await browser.newContext({ baseURL: BASE, locale: "pt-BR" });
  const page = await contexto.newPage();
  await entrar(page);
  await page.waitForURL(/\/mfa/, { timeout: 60_000 });
  await proximaJanela(page);
  await page.getByLabel("Não pedir o código de novo hoje neste aparelho").uncheck();
  await page.getByLabel("Código de 6 dígitos").fill(codigoTotp(segredo));
  await page.getByRole("button", { name: "Verificar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/mfa"), { timeout: 60_000 });

  const reaberto = await fecharEAbrir(browser, contexto);
  const p2 = await reaberto.newPage();
  await p2.goto("/conta");
  await p2.waitForURL(/\/login/, { timeout: 60_000 });
  await expect(p2.getByText("Por segurança, a sessão foi encerrada porque o portal foi fechado.", { exact: false })).toBeVisible();
  await reaberto.close();
});
