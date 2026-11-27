"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { hojeISO } from "@/lib/competencia";
import { lerPeriodo } from "./periodo";
import { gerarSnapshot, TIPOS_RELATORIO, type TipoRelatorio } from "./snapshot";

const UUID = /^[0-9a-f-]{36}$/i;

async function contextoPublicacao(empresaId: string) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.publicar")) throw new Error("Você não tem permissão para preparar relatórios desta empresa.");
  return ctx;
}

function revalidar(empresaId: string, id?: string) {
  revalidatePath(`/e/${empresaId}/relatorios/publicados`);
  if (id) revalidatePath(`/e/${empresaId}/relatorios/publicados/${id}`);
  revalidatePath("/escritorio/relatorios");
}

const esquemaNovo = z.object({
  tipo: z.enum(Object.keys(TIPOS_RELATORIO) as [TipoRelatorio, ...TipoRelatorio[]], { message: "Escolha o tipo de relatório." }),
  periodo: z.string().trim().min(2, "Escolha o período."),
  titulo: z.string().trim().max(160).optional(),
});

/** Cria um rascunho com a "foto" dos números do período e abre para revisão. */
export async function criarRascunho(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  let novoId: string | null = null;
  try {
    const ctx = await contextoPublicacao(empresaId);
    const d = esquemaNovo.safeParse({ tipo: fd.get("tipo"), periodo: fd.get("periodo"), titulo: fd.get("titulo") ?? undefined });
    if (!d.success) return falhaValidacao(d.error);
    const hoje = hojeISO();
    const periodo = lerPeriodo(d.data.periodo, hoje);
    const { snapshot, limitacoes } = await gerarSnapshot(ctx.supabase, empresaId, periodo, hoje);
    const titulo = d.data.titulo || `${TIPOS_RELATORIO[d.data.tipo].rotulo} — ${periodo.rotulo}`;
    const { data, error } = await ctx.supabase.rpc("salvar_rascunho_relatorio", {
      p_id: null as unknown as string,
      p_empresa_id: empresaId,
      p_tipo: d.data.tipo,
      p_titulo: titulo,
      p_competencia: (periodo.tipo === "mes" ? periodo.inicio : null) as unknown as string,
      p_inicio: periodo.inicio,
      p_fim: periodo.fim,
      p_dados: snapshot as never,
      p_resumo: snapshot.resumoAutomatico.join("\n\n"),
      p_comentarios: null as unknown as string,
      p_limitacoes: limitacoes as never,
    });
    if (error) return falha(mensagemErro(error));
    novoId = data as string;
    revalidar(empresaId, novoId);
  } catch (e) {
    return falha(mensagemErro(e));
  }
  redirect(`/e/${empresaId}/relatorios/publicados/${novoId}`);
}

const esquemaTextos = z.object({
  titulo: z.string().trim().min(3, "Informe o título.").max(160),
  resumo: z.string().trim().max(8000).optional(),
  comentarios: z.string().trim().max(8000).optional(),
});

export async function salvarTextos(empresaId: string, relatorioId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoPublicacao(empresaId);
    if (!UUID.test(relatorioId)) return falha("Relatório inválido.");
    const d = esquemaTextos.safeParse({ titulo: fd.get("titulo"), resumo: fd.get("resumo") ?? "", comentarios: fd.get("comentarios") ?? "" });
    if (!d.success) return falhaValidacao(d.error);
    const { data: rel } = await ctx.supabase
      .from("relatorios_publicados")
      .select("tipo, competencia, periodo_inicio, periodo_fim, status")
      .eq("id", relatorioId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!rel) return falha("Relatório não encontrado.");
    if (rel.status !== "rascunho") return falha("Relatórios publicados não podem ser alterados. Gere uma nova versão.");
    const { error } = await ctx.supabase.rpc("salvar_rascunho_relatorio", {
      p_id: relatorioId,
      p_empresa_id: empresaId,
      p_tipo: rel.tipo,
      p_titulo: d.data.titulo,
      p_competencia: rel.competencia as string,
      p_inicio: rel.periodo_inicio,
      p_fim: rel.periodo_fim,
      p_dados: null as never,
      p_resumo: d.data.resumo ?? "",
      p_comentarios: d.data.comentarios ?? "",
      p_limitacoes: null as never,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId, relatorioId);
    return sucesso("Rascunho salvo.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Refaz a "foto" dos números (mantém título e textos). */
export async function atualizarNumeros(empresaId: string, relatorioId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoPublicacao(empresaId);
    if (!UUID.test(relatorioId)) return falha("Relatório inválido.");
    const { data: rel } = await ctx.supabase
      .from("relatorios_publicados")
      .select("tipo, titulo, competencia, periodo_inicio, periodo_fim, status, dados, resumo_texto, comentarios_contador")
      .eq("id", relatorioId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!rel) return falha("Relatório não encontrado.");
    if (rel.status !== "rascunho") return falha("Somente rascunhos podem ser atualizados.");
    const hoje = hojeISO();
    const chave = (rel.dados as { periodo?: { chave?: string } } | null)?.periodo?.chave ?? rel.periodo_inicio.slice(0, 7);
    const { snapshot, limitacoes } = await gerarSnapshot(ctx.supabase, empresaId, lerPeriodo(chave, hoje), hoje);
    const { error } = await ctx.supabase.rpc("salvar_rascunho_relatorio", {
      p_id: relatorioId,
      p_empresa_id: empresaId,
      p_tipo: rel.tipo,
      p_titulo: rel.titulo,
      p_competencia: rel.competencia as string,
      p_inicio: rel.periodo_inicio,
      p_fim: rel.periodo_fim,
      p_dados: snapshot as never,
      p_resumo: rel.resumo_texto ?? "",
      p_comentarios: rel.comentarios_contador ?? "",
      p_limitacoes: limitacoes as never,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId, relatorioId);
    return sucesso("Números atualizados com os dados de agora. Revise o resumo antes de publicar.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function publicarRelatorio(empresaId: string, relatorioId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoPublicacao(empresaId);
    if (!UUID.test(relatorioId)) return falha("Relatório inválido.");
    const { data: rel } = await ctx.supabase.from("relatorios_publicados").select("id").eq("id", relatorioId).eq("empresa_id", empresaId).maybeSingle();
    if (!rel) return falha("Relatório não encontrado.");
    const { data, error } = await ctx.supabase.rpc("publicar_relatorio", { p_id: relatorioId });
    if (error) return falha(mensagemErro(error));
    const r = data as { versao: number; situacao: string };
    revalidar(empresaId, relatorioId);
    return sucesso(
      `Relatório publicado (versão ${r.versao}, ${r.situacao === "revisado" ? "revisado" : "preliminar"}). Os responsáveis pela empresa foram avisados.`,
    );
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function excluirRascunho(empresaId: string, relatorioId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoPublicacao(empresaId);
    if (!UUID.test(relatorioId)) return falha("Relatório inválido.");
    const { data: rel } = await ctx.supabase.from("relatorios_publicados").select("id").eq("id", relatorioId).eq("empresa_id", empresaId).maybeSingle();
    if (!rel) return falha("Relatório não encontrado.");
    const { error } = await ctx.supabase.rpc("excluir_rascunho_relatorio", { p_id: relatorioId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Rascunho excluído.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
