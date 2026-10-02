"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { dadosRequisicao } from "@/lib/requisicao";
import { booleano } from "@/lib/validacao";

const UUID = /^[0-9a-f-]{36}$/i;

const esquemaPerfil = z.object({
  nome: z.string().trim().min(2, "Informe seu nome.").max(120),
  telefone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone inválido. Use DDD + número."),
});

export async function salvarPerfil(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const d = esquemaPerfil.safeParse({ nome: fd.get("nome") ?? "", telefone: fd.get("telefone") ?? "" });
    if (!d.success) return falhaValidacao(d.error);
    const { error } = await s.supabase.from("perfis").update({ nome: d.data.nome, telefone: d.data.telefone || null }).eq("id", s.usuarioId);
    if (error) return falha(mensagemErro(error));
    revalidatePath("/conta");
    revalidatePath("/", "layout");
    return sucesso("Dados atualizados.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const esquemaSenha = z
  .object({
    atual: z.string().min(1, "Informe a senha atual."),
    senha: z
      .string()
      .min(10, "A nova senha precisa ter pelo menos 10 caracteres.")
      .regex(/[a-z]/, "Inclua ao menos uma letra minúscula.")
      .regex(/[A-Z]/, "Inclua ao menos uma letra maiúscula.")
      .regex(/\d/, "Inclua ao menos um número."),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ["confirmacao"], message: "As senhas não conferem." })
  .refine((d) => d.senha !== d.atual, { path: ["senha"], message: "A nova senha deve ser diferente da atual." });

/**
 * Troca de senha: confirma a senha atual (sem afetar a sessão em uso) e
 * atualiza no provedor de autenticação. O portal nunca guarda senhas.
 */
export async function alterarSenha(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const d = esquemaSenha.safeParse({ atual: fd.get("atual") ?? "", senha: fd.get("senha") ?? "", confirmacao: fd.get("confirmacao") ?? "" });
    if (!d.success) return falhaValidacao(d.error);
    const verificador = createClient(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: erroAtual } = await verificador.auth.signInWithPassword({ email: s.perfil.email, password: d.data.atual });
    if (erroAtual) return falha("A senha atual não confere.", { atual: ["Senha atual incorreta."] });
    // Encerra só a sessão criada para a verificação (o padrão "global" derrubaria todas).
    await verificador.auth.signOut({ scope: "local" });
    const { error } = await s.supabase.auth.updateUser({ password: d.data.senha });
    if (error) {
      if (error.code === "weak_password") return falha("Senha fraca ou já exposta em vazamentos conhecidos. Escolha outra.");
      if (error.code === "same_password") return falha("A nova senha deve ser diferente da atual.");
      if (error.code === "reauthentication_needed") return falha("Por segurança, saia e entre novamente antes de trocar a senha.");
      if (error.code === "session_not_found") return falha("Sua sessão expirou. Entre novamente para trocar a senha.");
      console.error("alterarSenha", error.code, error.status);
      return falha("Não foi possível trocar a senha. Tente novamente.");
    }
    const { ip, userAgent } = await dadosRequisicao();
    await s.supabase.rpc("registrar_evento", {
      p_acao: "senha_alterada",
      p_entidade: "perfis",
      p_entidade_id: s.usuarioId,
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
    });
    return sucesso("Senha alterada. Os outros dispositivos conectados foram desconectados.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function encerrarSessao(sessaoId: string): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    if (!UUID.test(sessaoId)) return falha("Sessão inválida.");
    const { error } = await s.supabase.rpc("encerrar_sessao", { p_sessao_id: sessaoId });
    if (error) return falha(mensagemErro(error));
    revalidatePath("/conta");
    return sucesso("Sessão encerrada. Aquele dispositivo precisará entrar novamente.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function encerrarOutrasSessoes(): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const { data, error } = await s.supabase.rpc("minhas_sessoes");
    if (error) return falha(mensagemErro(error));
    const outras = (data ?? []).filter((x) => !x.atual);
    for (const o of outras) await s.supabase.rpc("encerrar_sessao", { p_sessao_id: o.id });
    revalidatePath("/conta");
    return sucesso(outras.length ? `${outras.length} sessão(ões) encerrada(s). Só este dispositivo continua conectado.` : "Não há outras sessões abertas.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const TIPOS_LGPD = ["acesso", "correcao", "anonimizacao", "exclusao", "portabilidade", "informacao", "revogacao_consentimento"] as const;

export async function solicitarLgpd(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const d = z
      .object({ tipo: z.enum(TIPOS_LGPD, { message: "Escolha o tipo de pedido." }), descricao: z.string().trim().min(5, "Descreva o pedido.").max(4000) })
      .safeParse({ tipo: fd.get("tipo"), descricao: fd.get("descricao") ?? "" });
    if (!d.success) return falhaValidacao(d.error);
    const { error } = await s.supabase.rpc("criar_solicitacao_titular", { p_tipo: d.data.tipo, p_descricao: d.data.descricao });
    if (error) return falha(mensagemErro(error));
    revalidatePath("/conta");
    return sucesso("Pedido registrado. O escritório responderá pelo portal.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Registro do evento de 2FA removido (a remoção é feita no navegador, com sessão verificada). */
export async function registrarMfaRemovido(): Promise<void> {
  const s = await exigirSessao();
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", { p_acao: "mfa_removido", p_entidade: "perfis", p_entidade_id: s.usuarioId, p_ip: ip ?? undefined, p_user_agent: userAgent ?? undefined });
  revalidatePath("/conta");
}

/** Preferências de avisos (os avisos continuam aparecendo no sino do portal). */
export async function salvarPreferencias(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const s = await exigirSessao();
    const atuais = (s.perfil.preferencias ?? {}) as Record<string, unknown>;
    const { error } = await s.supabase
      .from("perfis")
      .update({ preferencias: { ...atuais, email_notificacoes: booleano(fd, "email_notificacoes") } })
      .eq("id", s.usuarioId);
    if (error) return falha(mensagemErro(error));
    revalidatePath("/conta");
    return sucesso("Preferências salvas.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
