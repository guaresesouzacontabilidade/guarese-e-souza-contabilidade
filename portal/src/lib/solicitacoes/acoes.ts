"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/solicitacoes`, "layout");
  revalidatePath("/escritorio/solicitacoes");
}

export async function abrirSolicitacao(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) return falha("Seu acesso não permite abrir solicitações.");
  const servico = texto(fd, "servico");
  const titulo = texto(fd, "titulo");
  const erros: Record<string, string[]> = {};
  if (!servico) erros.servico = ["Escolha o serviço."];
  if (titulo.length < 3 || titulo.length > 160) erros.titulo = ["Descreva o pedido em poucas palavras (3 a 160 caracteres)."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { data, error } = await ctx.supabase.rpc("abrir_solicitacao", {
    p_empresa_id: empresaId,
    p_servico: servico,
    p_titulo: titulo,
    p_descricao: texto(fd, "descricao").slice(0, 4000) || (null as unknown as string),
    p_prioridade: fd.get("urgente") === "on" ? "urgente" : "normal",
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  redirect(`/e/${empresaId}/solicitacoes/${data as string}`);
}

export async function atualizarSolicitacao(empresaId: string, solicitacaoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(solicitacaoId)) return falha("Solicitação inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  const status = texto(fd, "status");
  const responsavel = texto(fd, "responsavel");
  const prazo = texto(fd, "prazo");
  if (responsavel && !UUID.test(responsavel)) return falha("Responsável inválido.");
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return falha("Prazo inválido.");
  const comentario = texto(fd, "comentario").slice(0, 2000);
  if (!status && !responsavel && !prazo && !comentario) return falha("Nada para atualizar.");
  const { error } = await ctx.supabase.rpc("atualizar_solicitacao", {
    p_id: solicitacaoId,
    p_status: (status || null) as unknown as string,
    p_comentario: (comentario || null) as unknown as string,
    p_responsavel: (responsavel || null) as unknown as string,
    p_prazo: (prazo || null) as unknown as string,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Solicitação atualizada.");
}
