"use server";

import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Preferência pessoal de receber por e-mail as notificações do portal
 * (lida por app.notificar em perfis.preferencias.email_notificacoes).
 * Vale para todas as empresas que o usuário acessa.
 */
export async function salvarPreferenciaEmail(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  const ativo = fd.get("email_notificacoes") === "on";
  const atuais = (s.perfil.preferencias && typeof s.perfil.preferencias === "object" && !Array.isArray(s.perfil.preferencias) ? s.perfil.preferencias : {}) as { [chave: string]: Json | undefined };
  const { error } = await s.supabase
    .from("perfis")
    .update({ preferencias: { ...atuais, email_notificacoes: ativo } })
    .eq("id", s.usuarioId);
  if (error) return falha(mensagemErro(error));
  revalidatePath("/e/[empresaId]/configuracoes", "page");
  return sucesso(ativo ? "Você voltará a receber as notificações também por e-mail." : "Notificações por e-mail desativadas. Os avisos continuam no portal.");
}
