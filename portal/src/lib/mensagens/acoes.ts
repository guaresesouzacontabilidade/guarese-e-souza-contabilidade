"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { processarFilaDepois } from "@/lib/jobs/disparo";

const UUID = /^[0-9a-f-]{36}$/i;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/mensagens`, "layout");
  revalidatePath("/escritorio/mensagens");
}

const esquemaConversa = z.object({
  assunto: z.string().trim().min(3, "Informe o assunto.").max(200),
  corpo: z.string().trim().min(1, "Escreva a mensagem.").max(10000),
  tipo: z.enum(["mensagem", "solicitacao"]).default("mensagem"),
  competencia: z.string().optional().nullable(),
  anexos: z.array(z.string().regex(UUID)).max(20).default([]),
});

export async function criarConversa(empresaId: string, entrada: z.input<typeof esquemaConversa>): Promise<ResultadoAcao<{ id: string }>> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) return falha("Seu acesso não inclui mensagens desta empresa.");
  const d = esquemaConversa.safeParse(entrada);
  if (!d.success) return falhaValidacao(d.error);
  const comp = d.data.competencia ? lerCompetencia(d.data.competencia) : null;
  const { data, error } = await ctx.supabase.rpc("criar_conversa", {
    p_empresa_id: empresaId,
    p_assunto: d.data.assunto,
    p_corpo: d.data.corpo,
    p_tipo: ctx.equipe ? d.data.tipo : "mensagem",
    p_competencia: comp ?? undefined,
    p_documento_ids: d.data.anexos,
  });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["enviar_envio"] });
  revalidar(empresaId);
  return sucesso("Mensagem enviada.", { id: data as string });
}

export async function enviarMensagem(
  empresaId: string,
  conversaId: string,
  corpo: string,
  interna: boolean,
  anexos: string[],
): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!UUID.test(conversaId)) return falha("Conversa inválida.");
  if (!corpo.trim()) return falha("Escreva a mensagem.");
  if (corpo.length > 10000) return falha("Mensagem muito longa.");
  const { error } = await ctx.supabase.rpc("enviar_mensagem", {
    p_conversa_id: conversaId,
    p_corpo: corpo,
    p_interna: ctx.equipe ? interna : false,
    p_documento_ids: anexos.filter((a) => UUID.test(a)).slice(0, 20),
  });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["enviar_envio"] });
  revalidar(empresaId);
  return sucesso(interna ? "Nota interna registrada." : "Mensagem enviada.");
}

export async function alterarStatusConversa(empresaId: string, conversaId: string, status: "aberta" | "resolvida"): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("alterar_status_conversa", { p_conversa_id: conversaId, p_status: status });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(status === "resolvida" ? "Conversa marcada como resolvida." : "Conversa reaberta.");
}
