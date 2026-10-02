"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa, type ContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { booleano, textoOpcional, uuidOpcional } from "@/lib/validacao";
import { lerCompetencia } from "@/lib/competencia";

const ETAPAS = ["coleta", "conferencia", "conciliacao", "revisao", "publicacao"] as const;
const STATUS_ETAPA = ["nao_iniciada", "em_andamento", "concluida"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath("/escritorio/fechamentos");
  revalidatePath("/escritorio");
}

export async function iniciarFechamento(empresaId: string, competencia: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return falha("Sem permissão para conduzir o fechamento.");
  const comp = lerCompetencia(competencia);
  if (!comp) return falha("Competência inválida.");
  const { error } = await ctx.supabase.rpc("iniciar_fechamento", { p_empresa_id: empresaId, p_competencia: comp });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Fechamento iniciado. A etapa de coleta de documentos está em andamento.");
}

const esquemaEtapa = z.object({
  status: z.enum(STATUS_ETAPA, { message: "Selecione a situação da etapa." }),
  responsavel_id: uuidOpcional,
  observacao: textoOpcional,
});

export async function atualizarEtapa(empresaId: string, etapaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return falha("Sem permissão para conduzir o fechamento.");
  if (!UUID.test(etapaId)) return falha("Etapa inválida.");
  const dados = esquemaEtapa.safeParse({
    status: String(fd.get("status") ?? ""),
    responsavel_id: String(fd.get("responsavel_id") ?? ""),
    observacao: String(fd.get("observacao") ?? ""),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  return gravarEtapa(ctx, empresaId, etapaId, dados.data.status, dados.data.responsavel_id ?? null, dados.data.observacao ?? null);
}

/** Mudança rápida de situação (botões Iniciar / Concluir / Voltar). */
export async function alterarStatusEtapa(empresaId: string, etapaId: string, status: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return falha("Sem permissão para conduzir o fechamento.");
  if (!UUID.test(etapaId)) return falha("Etapa inválida.");
  const s = z.enum(STATUS_ETAPA).safeParse(status);
  if (!s.success) return falha("Situação de etapa inválida.");
  return gravarEtapa(ctx, empresaId, etapaId, s.data, null, null);
}

async function gravarEtapa(
  ctx: ContextoEmpresa,
  empresaId: string,
  etapaId: string,
  status: string,
  responsavelId: string | null,
  observacao: string | null,
): Promise<ResultadoAcao> {
  const { data: etapa } = await ctx.supabase.from("fechamento_etapas").select("id").eq("id", etapaId).eq("empresa_id", empresaId).maybeSingle();
  if (!etapa) return falha("Etapa não encontrada nesta empresa.");
  const { error } = await ctx.supabase.rpc("atualizar_etapa_fechamento", {
    p_etapa_id: etapaId,
    p_status: status,
    p_responsavel_id: responsavelId ?? undefined,
    p_observacao: observacao ?? undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  const mensagens: Record<string, string> = {
    nao_iniciada: "Etapa marcada como não iniciada.",
    em_andamento: "Etapa em andamento.",
    concluida: "Etapa concluída.",
  };
  return sucesso(mensagens[status] ?? "Etapa atualizada.");
}

const esquemaPendencia = z.object({
  etapa: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v == null || (ETAPAS as readonly string[]).includes(v), "Etapa inválida."),
  descricao: z.string().trim().min(5, "Descreva a pendência (mínimo de 5 caracteres).").max(2000, "Descrição muito longa."),
  impeditiva: z.boolean(),
  visivel_cliente: z.boolean(),
});

export async function registrarPendencia(empresaId: string, competenciaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return falha("Sem permissão para conduzir o fechamento.");
  if (!UUID.test(competenciaId)) return falha("Competência inválida.");
  const dados = esquemaPendencia.safeParse({
    etapa: String(fd.get("etapa") ?? ""),
    descricao: String(fd.get("descricao") ?? ""),
    impeditiva: booleano(fd, "impeditiva"),
    visivel_cliente: booleano(fd, "visivel_cliente"),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { data: comp } = await ctx.supabase.from("competencias").select("id").eq("id", competenciaId).eq("empresa_id", empresaId).maybeSingle();
  if (!comp) return falha("Competência não encontrada nesta empresa.");
  const d = dados.data;
  const { error } = await ctx.supabase.rpc("registrar_pendencia_fechamento", {
    p_competencia_id: competenciaId,
    p_etapa: d.etapa as string, // null = pendência geral (o banco aceita)
    p_descricao: d.descricao,
    p_impeditiva: d.impeditiva,
    p_visivel_cliente: d.visivel_cliente,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(d.visivel_cliente ? "Pendência registrada e enviada ao cliente." : "Pendência registrada.");
}

export async function resolverPendencia(empresaId: string, pendenciaId: string, status: string, resolucao: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return falha("Sem permissão para conduzir o fechamento.");
  if (!UUID.test(pendenciaId)) return falha("Pendência inválida.");
  const s = z.enum(["resolvida", "dispensada", "aberta"]).safeParse(status);
  if (!s.success) return falha("Situação inválida.");
  const texto = resolucao.trim().slice(0, 2000);
  if (s.data === "dispensada" && !texto) return falha("Justifique a dispensa da pendência.");
  const { data: pend } = await ctx.supabase.from("fechamento_pendencias").select("id").eq("id", pendenciaId).eq("empresa_id", empresaId).maybeSingle();
  if (!pend) return falha("Pendência não encontrada nesta empresa.");
  const { error } = await ctx.supabase.rpc("resolver_pendencia_fechamento", { p_pendencia_id: pendenciaId, p_status: s.data, p_resolucao: texto });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  const mensagens = { resolvida: "Pendência resolvida.", dispensada: "Pendência dispensada.", aberta: "Pendência reaberta." };
  return sucesso(mensagens[s.data]);
}

export async function fecharCompetencia(empresaId: string, competencia: string, observacao: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.gerenciar")) return falha("Sem permissão para fechar a competência.");
  const comp = lerCompetencia(competencia);
  if (!comp) return falha("Competência inválida.");
  const { error } = await ctx.supabase.rpc("fechar_competencia", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_observacao: observacao.trim().slice(0, 2000) || undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Competência fechada. Novos documentos e lançamentos deste mês passam a exigir reabertura.");
}

export async function reabrirCompetencia(empresaId: string, competencia: string, justificativa: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("fechamento.reabrir")) return falha("Sem permissão para reabrir a competência.");
  const comp = lerCompetencia(competencia);
  if (!comp) return falha("Competência inválida.");
  const texto = justificativa.trim().slice(0, 2000);
  if (texto.length < 10) return falha("Informe uma justificativa detalhada (mínimo de 10 caracteres).");
  const { error } = await ctx.supabase.rpc("reabrir_competencia", { p_empresa_id: empresaId, p_competencia: comp, p_justificativa: texto });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Competência reaberta. As etapas de revisão e publicação voltaram para andamento e a equipe foi avisada.");
}
