import { test, expect } from "@playwright/test";
import { createHmac, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Redefinir a senha pelo link do e-mail numa conta com verificação em duas
 * etapas: o portal pede antes o código do aplicativo (o provedor recusa a troca
 * sem ele) e depois aceita a nova senha. Antes, aparecia "senha fraca".
 * Usuário fictício criado só para o teste.
 */
const BASE = process.env.PORTAL_URL ?? "http://localhost:3000";
const SENHA = `Teste-${randomInt(100000, 999999)}-Ab1`;
const NOVA = `Nova-${randomInt(100000, 999999)}-Xy9z`;
const EMAIL = `e2e-senha-2fa-${randomInt(100000, 999999)}@demo.guareses.test`;

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

/** Código TOTP (RFC 6238, 30 s, 6 dígitos). */
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

const servico = clienteServico();
test.skip(!servico, "Precisa do Supabase local (.env.local).");

let usuarioId = "";

test.afterAll(async () => {
  if (usuarioId) await servico!.auth.admin.deleteUser(usuarioId);
});

test("conta com verificação em duas etapas: o link de senha pede o código e depois aceita a nova senha", async ({ page }) => {
  test.setTimeout(180_000);
  const { data: criado, error } = await servico!.auth.admin.createUser({
    email: EMAIL,
    password: SENHA,
    email_confirm: true,
    app_metadata: { tipo: "cliente" },
    user_metadata: { nome: "Teste Senha Duas Etapas (E2E)" },
  });
  if (error) throw new Error(error.message);
  usuarioId = criado.user.id;

  // Cadastra o aplicativo autenticador como o próprio usuário
  const usuario = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  await usuario.auth.signInWithPassword({ email: EMAIL, password: SENHA });
  const { data: fator, error: e1 } = await usuario.auth.mfa.enroll({ factorType: "totp" });
  if (e1 || !fator) throw new Error(e1?.message ?? "sem fator");
  const segredo = fator.totp.secret;
  const { error: e2 } = await usuario.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigoTotp(segredo) });
  if (e2) throw new Error(e2.message);

  // Link de redefinição (o mesmo que vai no e-mail)
  const { data: link, error: e3 } = await servico!.auth.admin.generateLink({ type: "recovery", email: EMAIL });
  if (e3 || !link.properties?.hashed_token) throw new Error(e3?.message ?? "sem link");
  await page.goto(`${BASE}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=recovery&next=/redefinir-senha`);
  await page.getByRole("button", { name: "Continuar" }).click();

  // Primeiro o código do aplicativo, com a explicação
  await page.waitForURL(/\/mfa\?proximo=%2Fredefinir-senha|\/mfa\?proximo=\/redefinir-senha/, { timeout: 60_000 });
  await expect(page.getByText(/Para criar a nova senha, informe antes o código do aplicativo autenticador/)).toBeVisible();
  await expect(page.getByText(/Peça ao administrador do escritório para remover a verificação/)).toBeVisible();
  // O código já usado no cadastro não vale de novo: espera a próxima janela de 30 s
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 500);
  await page.getByLabel("Código de 6 dígitos").fill(codigoTotp(segredo));
  await page.getByRole("button", { name: "Verificar" }).click();

  // Depois, a nova senha é aceita (sem a mensagem de senha fraca)
  await page.waitForURL((u) => u.pathname === "/redefinir-senha", { timeout: 60_000 });
  await page.getByLabel("Nova senha", { exact: true }).fill(NOVA);
  await page.getByLabel("Confirme a nova senha").fill(NOVA);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/redefinir-senha"), { timeout: 60_000 });
  await expect(page.getByText(/Senha fraca/)).toHaveCount(0);

  // A nova senha vale para entrar
  const outro = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error: e4 } = await outro.auth.signInWithPassword({ email: EMAIL, password: NOVA });
  expect(e4).toBeNull();
});

test("conta sem verificação em duas etapas: o link de senha vai direto para a nova senha", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `e2e-senha-${randomInt(100000, 999999)}@demo.guareses.test`;
  const { data: criado, error } = await servico!.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
    app_metadata: { tipo: "cliente" },
    user_metadata: { nome: "Teste Senha (E2E)" },
  });
  if (error) throw new Error(error.message);
  try {
    const { data: link } = await servico!.auth.admin.generateLink({ type: "recovery", email });
    await page.goto(`${BASE}/auth/confirm?token_hash=${encodeURIComponent(link.properties!.hashed_token)}&type=recovery&next=/redefinir-senha`);
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL((u) => u.pathname === "/redefinir-senha", { timeout: 60_000 });
    await page.getByLabel("Nova senha", { exact: true }).fill(NOVA);
    await page.getByLabel("Confirme a nova senha").fill(NOVA);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/redefinir-senha"), { timeout: 60_000 });
  } finally {
    await servico!.auth.admin.deleteUser(criado.user.id);
  }
});
