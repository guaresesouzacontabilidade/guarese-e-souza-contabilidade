"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { envPublico } from "@/lib/env";
import { falha, type ResultadoAcao } from "@/lib/acoes";
import { dadosRequisicao, destinoSeguro } from "@/lib/requisicao";
import { COOKIE_PRESENCA, PRESENCA_SEGUNDOS } from "@/lib/auth/presenca";

/** Senhas erradas seguidas antes de encerrar a sessão travada (o próximo acesso pede senha e código). */
const LIMITE_TENTATIVAS = 5;

/**
 * Destrava a sessão mantida no dia: confere a senha num login à parte (que é
 * desfeito na hora) e, se estiver certa, o servidor libera a sessão travada.
 * A própria pessoa não consegue destravar pela API sem a senha.
 */
export async function desbloquearSessao(_anterior: ResultadoAcao, formData: FormData): Promise<ResultadoAcao> {
  const senha = String(formData.get("senha") ?? "");
  const pedido = destinoSeguro(String(formData.get("proximo") ?? "") || null);
  const proximo = pedido.startsWith("/desbloquear") ? "/painel" : pedido;
  if (!senha) return falha("Digite a sua senha.");

  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const sessaoId = typeof claims?.session_id === "string" ? claims.session_id : null;
  const email = typeof claims?.email === "string" ? claims.email : null;
  if (!claims?.sub || !sessaoId || !email) redirect("/login");

  // Login à parte, só para conferir a senha (não grava cookies e é encerrado em seguida)
  const conferencia = createClient(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await conferencia.auth.signInWithPassword({ email, password: senha });
  const admin = criarClienteAdmin();
  if (error) {
    if (/rate limit|too many/i.test(error.message)) return falha("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    const { data: tentativas } = await admin.rpc("sessao_desbloqueio", { p_session_id: sessaoId, p_user_id: claims.sub, p_senha_ok: false });
    if (Number(tentativas) >= LIMITE_TENTATIVAS) redirect("/auth/sair?motivo=sessao");
    const restam = LIMITE_TENTATIVAS - Number(tentativas ?? 0);
    return falha(`Senha incorreta. ${restam === 1 ? "Resta 1 tentativa" : `Restam ${restam} tentativas`} antes de pedir senha e código de novo.`);
  }
  await conferencia.auth.signOut({ scope: "local" });

  const { error: erroLiberar } = await admin.rpc("sessao_desbloqueio", { p_session_id: sessaoId, p_user_id: claims.sub, p_senha_ok: true });
  if (erroLiberar) redirect("/auth/sair?motivo=sessao");

  // Sinal de "portal aberto" (senão a sessão seria travada de novo na próxima página)
  (await cookies()).set(COOKIE_PRESENCA, "1", { maxAge: PRESENCA_SEGUNDOS, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  const { ip, userAgent } = await dadosRequisicao();
  await supabase.rpc("registrar_login", { p_ip: ip ?? undefined, p_user_agent: userAgent ?? undefined });
  redirect(proximo);
}
