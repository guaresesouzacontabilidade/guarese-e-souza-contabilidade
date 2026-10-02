"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { exigirSessao } from "@/lib/auth/sessao";
import { mensagemErroSenha, regraSenha } from "@/lib/auth/senha";
import { envPublico } from "@/lib/env";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { dadosRequisicao } from "@/lib/requisicao";

const esquemaPerfil = z.object({
  nome: z.string().trim().min(2, "Informe o nome.").max(120, "Nome muito longo."),
  telefone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone inválido. Informe DDD e número.")
    .transform((v) => (v === "" ? null : v)),
});

/** Atualiza nome e telefone do próprio usuário (RLS: somente o próprio perfil). */
export async function atualizarMeuPerfil(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  const dados = esquemaPerfil.safeParse({ nome: fd.get("nome") ?? "", telefone: fd.get("telefone") ?? "" });
  if (!dados.success) return falhaValidacao(dados.error);
  const { error } = await s.supabase.from("perfis").update(dados.data).eq("id", s.usuarioId);
  if (error) return falha(mensagemErro(error));
  revalidatePath("/", "layout");
  return sucesso("Dados atualizados.");
}

const esquemaSenha = z
  .object({
    senha_atual: z.string().min(1, "Informe a senha atual."),
    senha: regraSenha,
    confirmacao: z.string(),
    encerrar_outras: z.boolean(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ["confirmacao"], message: "As senhas não conferem." })
  .refine((d) => d.senha !== d.senha_atual, { path: ["senha"], message: "A nova senha deve ser diferente da atual." });

/**
 * Troca a senha conferindo a senha atual. A conferência usa um cliente
 * temporário (sem cookies); a sessão criada por ela é encerrada em seguida.
 */
export async function alterarMinhaSenha(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  const dados = esquemaSenha.safeParse({
    senha_atual: fd.get("senha_atual") ?? "",
    senha: fd.get("senha") ?? "",
    confirmacao: fd.get("confirmacao") ?? "",
    encerrar_outras: fd.get("encerrar_outras") === "on",
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const d = dados.data;

  const temporario = createClient(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const conferencia = await temporario.auth.signInWithPassword({ email: s.email, password: d.senha_atual });
  if (conferencia.error) {
    if (/rate limit|too many/i.test(conferencia.error.message)) return falha("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    return falha("Revise os campos destacados.", { senha_atual: ["Senha atual incorreta."] });
  }
  await temporario.auth.signOut({ scope: "local" });

  const { error } = await s.supabase.auth.updateUser({ password: d.senha });
  if (error) return falha(mensagemErroSenha(error.message, "Não foi possível alterar a senha. Tente novamente."));

  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "senha_alterada",
    p_entidade: "perfis",
    p_entidade_id: s.usuarioId,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  if (d.encerrar_outras) {
    const n = await encerrarOutras(s);
    return sucesso(n ? `Senha alterada. ${n} sessão(ões) em outros dispositivos foram encerradas.` : "Senha alterada.");
  }
  return sucesso("Senha alterada.");
}

/** Remove um fator de verificação em duas etapas do próprio usuário. */
export async function removerFatorMfa(fatorId: string): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  if (!z.string().uuid().safeParse(fatorId).success) return falha("Fator inválido.");
  const { data: lista, error: erroLista } = await s.supabase.auth.mfa.listFactors();
  if (erroLista || !lista) return falha("Não foi possível consultar os fatores de verificação.");
  const fator = lista.all.find((f) => f.id === fatorId);
  if (!fator) return falha("Fator não encontrado.");
  const verificados = lista.all.filter((f) => f.status === "verified");
  if (fator.status === "verified" && s.estado.exige_2fa && verificados.length <= 1) {
    return falha("O escritório exige a verificação em duas etapas para o seu perfil. Cadastre outro aplicativo antes de remover este.");
  }
  const { error } = await s.supabase.auth.mfa.unenroll({ factorId: fatorId });
  if (error) {
    if (/aal2|assurance/i.test(error.message)) return falha("Confirme o código da verificação em duas etapas (entre novamente) antes de remover o fator.");
    return falha("Não foi possível remover o fator. Tente novamente.");
  }
  if (fator.status === "verified") {
    const { ip, userAgent } = await dadosRequisicao();
    await s.supabase.rpc("registrar_evento", {
      p_acao: "mfa_removido",
      p_entidade: "perfis",
      p_entidade_id: s.usuarioId,
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
    });
  }
  revalidatePath("/conta");
  return sucesso("Verificação em duas etapas removida deste aplicativo.");
}

/** Encerra uma sessão do próprio usuário (em outro dispositivo). */
export async function encerrarMinhaSessao(sessaoId: string): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  if (!z.string().uuid().safeParse(sessaoId).success) return falha("Sessão inválida.");
  if (sessaoId === s.sessaoId) return falha("Para encerrar a sessão atual, use “Sair”.");
  const { error } = await s.supabase.rpc("encerrar_sessao", { p_sessao_id: sessaoId });
  if (error) return falha(mensagemErro(error));
  revalidatePath("/conta");
  return sucesso("Sessão encerrada.");
}

/** Encerra todas as sessões do próprio usuário, exceto a atual. */
export async function encerrarOutrasSessoes(): Promise<ResultadoAcao> {
  const s = await exigirSessao();
  try {
    const n = await encerrarOutras(s);
    revalidatePath("/conta");
    return sucesso(n ? `${n} sessão(ões) encerrada(s).` : "Não há outras sessões ativas.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

async function encerrarOutras(s: Awaited<ReturnType<typeof exigirSessao>>) {
  const { data, error } = await s.supabase.rpc("minhas_sessoes");
  if (error) throw error;
  const outras = (data ?? []).filter((x) => !x.atual && x.id !== s.sessaoId);
  for (const x of outras) {
    const r = await s.supabase.rpc("encerrar_sessao", { p_sessao_id: x.id });
    if (r.error) throw r.error;
  }
  return outras.length;
}
