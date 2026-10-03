"use server";

import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A tela é dinâmica e o botão atualiza a página depois da mensagem: as ações não revalidam.

async function contexto(empresaId: string, arquivoId: string) {
  if (!UUID.test(empresaId) || !UUID.test(arquivoId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode("auditor.gerenciar") ? ctx : null;
}

export async function conferirSpedDeNovo(empresaId: string, arquivoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, arquivoId);
  if (!ctx) return falha("Seu acesso não permite conferir o SPED.");
  const { data, error } = await ctx.supabase.rpc("sped_conferir_de_novo", { p_arquivo_id: arquivoId });
  if (error) return falha(mensagemErro(error));
  const r = (data ?? {}) as { alta?: number; media?: number };
  const pontos = (r.alta ?? 0) + (r.media ?? 0);
  return sucesso(pontos ? `Conferido de novo: ${pontos} ${pontos === 1 ? "ponto" : "pontos"} para conferir.` : "Conferido de novo: as notas batem com os XML.");
}

export async function excluirSped(empresaId: string, arquivoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, arquivoId);
  if (!ctx) return falha("Seu acesso não permite esta ação.");
  const { error } = await ctx.supabase.rpc("sped_excluir_arquivo", { p_arquivo_id: arquivoId });
  if (error) return falha(mensagemErro(error));
  return sucesso("Arquivo tirado da conferência. O documento continua em Documentos.");
}
