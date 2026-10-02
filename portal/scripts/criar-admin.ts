/**
 * Cria (ou promove) o primeiro administrador do escritório.
 *
 * Uso:
 *   npm run criar-admin -- --email voce@exemplo.com --nome "Seu Nome" [--senha "SenhaForte123"]
 *
 * Sem --senha, a pessoa recebe um convite para definir a própria senha: por
 * e-mail com --enviar-email (exige o e-mail do login configurado) ou, sem essa
 * opção, por um link de uso único impresso na tela.
 * Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente (.env.local).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { carregarEnv } from "./util-env";

carregarEnv();

function argumento(nome: string) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type ClienteAdmin = SupabaseClient;

async function marcarAdmin(admin: ClienteAdmin, id: string, nome: string) {
  await admin.auth.admin.updateUserById(id, { app_metadata: { tipo: "admin" } });
  // O perfil é criado por gatilho; o tipo é definido explicitamente aqui.
  await admin.from("perfis").update({ tipo: "admin", ativo: true, nome }).eq("id", id);
}

/**
 * Entrega o acesso a quem ainda não definiu a senha: por e-mail, quando o login
 * já envia e-mails (SMTP configurado e --enviar-email); senão, um link de uso
 * único impresso na tela.
 */
async function entregarAcesso(admin: ClienteAdmin, email: string, nome: string, site: string, jaExiste: boolean, porEmail: boolean) {
  if (porEmail) {
    const { data, error } = jaExiste
      ? await admin.auth.resetPasswordForEmail(email, { redirectTo: `${site}/redefinir-senha` }).then((r) => ({ data: null, error: r.error }))
      : await admin.auth.admin.inviteUserByEmail(email, { data: { nome } });
    if (!error) {
      if (data?.user) await marcarAdmin(admin, data.user.id, nome);
      console.log(`Convite enviado por e-mail para ${email}.`);
      return;
    }
    console.log(`Não foi possível enviar o e-mail (${error.message}). Gerando o link de acesso.`);
  }
  const tipo = jaExiste ? "recovery" : "invite";
  const { data, error } =
    tipo === "invite"
      ? await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { nome } } })
      : await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error) throw error;
  await marcarAdmin(admin, data.user.id, nome);
  const link = `${site}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${tipo}&next=/definir-senha`;
  console.log(`Administrador convidado: ${email}`);
  console.log(`Link para definir a senha (uso único):\n${link}`);
}

async function main() {
  const email = argumento("email")?.trim().toLowerCase();
  const nome = argumento("nome")?.trim();
  const senha = argumento("senha");
  const porEmail = process.argv.includes("--enviar-email");
  if (!email || !nome) {
    console.error('Uso: npm run criar-admin -- --email voce@exemplo.com --nome "Seu Nome" [--senha "SenhaForte123"] [--enviar-email]');
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
    const { data: u } = await admin.auth.admin.getUserById(existente.id);
    if (!senha && u.user && !u.user.last_sign_in_at) {
      // Ainda não entrou (o convite anterior pode ter expirado): novo acesso.
      await entregarAcesso(admin, email, nome, site, true, porEmail);
      return;
    }
    await marcarAdmin(admin, existente.id, nome);
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
    await marcarAdmin(admin, data.user.id, nome);
    console.log(`Administrador criado: ${data.user.email}. Acesse ${site}/login`);
    return;
  }

  await entregarAcesso(admin, email, nome, site, false, porEmail);
}

main().catch((e) => {
  console.error("Erro:", e instanceof Error ? e.message : e);
  process.exit(1);
});
