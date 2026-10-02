/**
 * Cria (ou promove) o primeiro administrador do escritório.
 *
 * Uso:
 *   npm run criar-admin -- --email voce@exemplo.com --nome "Seu Nome" [--senha "SenhaForte123"]
 *
 * Sem --senha, é gerado um link de convite (válido conforme o prazo do Auth)
 * para que a pessoa defina a própria senha.
 * Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente (.env.local).
 */
import { createClient } from "@supabase/supabase-js";
import { carregarEnv } from "./util-env";

carregarEnv();

function argumento(nome: string) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = argumento("email")?.trim().toLowerCase();
  const nome = argumento("nome")?.trim();
  const senha = argumento("senha");
  if (!email || !nome) {
    console.error('Uso: npm run criar-admin -- --email voce@exemplo.com --nome "Seu Nome" [--senha "SenhaForte123"]');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!url || !chave) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY.");
  const admin = createClient(url, chave, { auth: { persistSession: false } });

  // Usuário já existe?
  const { data: existente } = await admin.from("perfis").select("id, tipo").eq("email", email).maybeSingle();
  if (existente) {
    await admin.auth.admin.updateUserById(existente.id, { app_metadata: { tipo: "admin" } });
    await admin.from("perfis").update({ tipo: "admin", ativo: true, nome }).eq("id", existente.id);
    console.log(`Usuário ${email} promovido a administrador.`);
    return;
  }

  if (senha) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
      app_metadata: { tipo: "admin" },
    });
    if (error) throw error;
    // O perfil é criado por gatilho; o tipo é definido explicitamente aqui.
    await admin.from("perfis").update({ tipo: "admin", nome }).eq("id", data.user.id);
    console.log(`Administrador criado: ${data.user.email}. Acesse ${site}/login`);
    return;
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { nome } },
  });
  if (error) throw error;
  await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { tipo: "admin" } });
  await admin.from("perfis").update({ tipo: "admin", nome }).eq("id", data.user.id);
  const link = `${site}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite&next=/definir-senha`;
  console.log(`Administrador convidado: ${email}`);
  console.log(`Link para definir a senha (uso único):\n${link}`);
}

main().catch((e) => {
  console.error("Erro:", e instanceof Error ? e.message : e);
  process.exit(1);
});
