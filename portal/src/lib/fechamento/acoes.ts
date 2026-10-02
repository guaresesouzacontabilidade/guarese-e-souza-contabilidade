"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";

const UUID = /^[0-9a-f-]{36}$/i;
const ETAPAS = ["coleta", "conferencia", "conciliacao", "revisao", "publicacao"] as const;

async function contexto(empresaId: string, permissao: "fechamento.gerenciar" | "fechamento.reabrir" = "fechamento.gerenciar") {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode(permissao)) {
    throw new Error(permissao === "fechamento.reabrir" ? "Somente quem tem permissão de reabertura pode reabrir uma competência fechada." : "Você não tem permissão para conduzir o fechamento desta empresa.");
  }
  return ctx;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/fechamento`);
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath("/escritorio/fechamentos");
}

function competencia(valor: string) {
  const c = lerCompetencia(valor);
  if (!c) throw new Error("Competência inválida.");
  return c;
}

export async function iniciarFechamento(empresaId: string, comp: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("iniciar_fechamento", { p_empresa_id: empresaId, p_competencia: competencia(comp) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`Fechamento de ${formatarCompetencia(competencia(comp), true)} iniciado.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const esquemaEtapa = z.object({
  status: z.enum(["nao_iniciada", "em_andamento", "concluida"]),
  responsavel_id: z.string().regex(UUID).nullable().optional(),
  observacao: z.string().trim().max(1000).nullable().optional(),
});

export async function atualizarEtapa(empresaId: string, etapaId: string, dados: z.input<typeof esquemaEtapa>): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!UUID.test(etapaId)) return falha("Etapa inválida.");
    const d = esquemaEtapa.safeParse(dados);
    if (!d.success) return falhaValidacao(d.error);
    const { data: etapa } = await ctx.supabase.from("fechamento_etapas").select("id").eq("id", etapaId).eq("empresa_id", empresaId).maybeSingle();
    if (!etapa) return falha("Etapa não encontrada.");
    const { error } = await ctx.supabase.rpc("atualizar_etapa_fechamento", {
      p_etapa_id: etapaId,
      p_status: d.data.status,
      p_responsavel_id: d.data.responsavel_id ?? undefined,
      p_observacao: d.data.observacao || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(d.data.status === "concluida" ? "Etapa concluída." : "Etapa atualizada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const esquemaPendencia = z.object({
  etapa: z.enum(ETAPAS, { message: "Escolha a etapa." }),
  descricao: z.string().trim().min(3, "Descreva a pendência.").max(1000),
  impeditiva: z.boolean(),
  visivel_cliente: z.boolean(),
});

export async function registrarPendencia(empresaId: string, competenciaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!UUID.test(competenciaId)) return falha("Competência inválida.");
    const d = esquemaPendencia.safeParse({
      etapa: fd.get("etapa"),
      descricao: fd.get("descricao"),
      impeditiva: fd.get("impeditiva") === "on",
      visivel_cliente: fd.get("visivel_cliente") === "on",
    });
    if (!d.success) return falhaValidacao(d.error);
    const { data: comp } = await ctx.supabase.from("competencias").select("id").eq("id", competenciaId).eq("empresa_id", empresaId).maybeSingle();
    if (!comp) return falha("Competência não encontrada.");
    const { error } = await ctx.supabase.rpc("registrar_pendencia_fechamento", {
      p_competencia_id: competenciaId,
      p_etapa: d.data.etapa,
      p_descricao: d.data.descricao,
      p_impeditiva: d.data.impeditiva,
      p_visivel_cliente: d.data.visivel_cliente,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(d.data.visivel_cliente ? "Pendência registrada e enviada ao cliente." : "Pendência registrada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function resolverPendencia(empresaId: string, pendenciaId: string, status: "resolvida" | "dispensada" | "aberta", resolucao: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!UUID.test(pendenciaId)) return falha("Pendência inválida.");
    const { data: p } = await ctx.supabase.from("fechamento_pendencias").select("id").eq("id", pendenciaId).eq("empresa_id", empresaId).maybeSingle();
    if (!p) return falha("Pendência não encontrada.");
    const { error } = await ctx.supabase.rpc("resolver_pendencia_fechamento", { p_pendencia_id: pendenciaId, p_status: status, p_resolucao: resolucao.trim().slice(0, 1000) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(status === "aberta" ? "Pendência reaberta." : status === "dispensada" ? "Pendência dispensada." : "Pendência resolvida.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function fecharCompetencia(empresaId: string, comp: string, observacao: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const c = competencia(comp);
    const { error } = await ctx.supabase.rpc("fechar_competencia", { p_empresa_id: empresaId, p_competencia: c, p_observacao: observacao.trim().slice(0, 1000) || undefined });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`${formatarCompetencia(c, true)} fechado. Lançamentos, baixas e documentos do mês ficam protegidos contra alterações.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function reabrirCompetencia(empresaId: string, comp: string, justificativa: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "fechamento.reabrir");
    const c = competencia(comp);
    if (justificativa.trim().length < 10) return falha("Explique o motivo da reabertura (mínimo de 10 caracteres).");
    const { error } = await ctx.supabase.rpc("reabrir_competencia", { p_empresa_id: empresaId, p_competencia: c, p_justificativa: justificativa.trim().slice(0, 1000) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`${formatarCompetencia(c, true)} reaberto. A equipe foi avisada.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
