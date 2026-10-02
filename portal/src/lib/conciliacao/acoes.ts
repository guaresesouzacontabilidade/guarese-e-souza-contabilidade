"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { dataObrigatoria, dataOpcional, textoOpcional, uuidOpcional, valorMonetario } from "@/lib/validacao";
import { lerCompetencia, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { gerarSugestoes } from "./motor";
import { avaliarFinalizacao } from "./regras";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRATAMENTO = z.enum(["juros", "multa", "desconto", "taxa", "parcial"]);

async function contexto(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("conciliacao.executar")) throw new Error("Seu acesso não permite conciliar movimentações desta empresa.");
  return ctx;
}

type Ctx = Awaited<ReturnType<typeof contexto>>;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/conciliacao`);
  revalidatePath(`/e/${empresaId}/financeiro`, "layout");
  revalidatePath("/escritorio/conciliacao");
}

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "");
}

/** Confere que a conciliação é desta empresa (o banco também valida a permissão). */
async function conciliacaoDaEmpresa(ctx: Ctx, empresaId: string, id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await ctx.supabase.from("conciliacoes").select("id, status").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
  return data;
}

async function movimentosDaEmpresa(ctx: Ctx, empresaId: string, ids: string[]) {
  if (!ids.length || ids.some((i) => !UUID.test(i))) return false;
  const { count } = await ctx.supabase.from("movimentos_bancarios").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("id", ids);
  return count === ids.length;
}

// ------------------------------------------------------------------ sugestões
export async function gerarSugestoesAgora(empresaId: string): Promise<ResultadoAcao<{ sugestoes: number }>> {
  try {
    const ctx = await contexto(empresaId);
    // Executa com a sessão do usuário: leitura pelo RLS e registro pelo RPC (que exige conciliacao.executar).
    const r = await gerarSugestoes(ctx.supabase, empresaId);
    revalidar(empresaId);
    if (!r.analisadas) return sucesso("Não há movimentações pendentes sem sugestão para analisar.", { sugestoes: 0 });
    return sucesso(
      r.sugestoes ? `${r.sugestoes} nova(s) sugestão(ões) encontrada(s) em ${r.analisadas} movimentação(ões) analisada(s).` : `Nenhuma correspondência nova encontrada em ${r.analisadas} movimentação(ões).`,
      { sugestoes: r.sugestoes },
    );
  } catch (e) {
    return falha(e instanceof Error ? mensagemErro(e) : "Não foi possível gerar as sugestões.");
  }
}

export async function confirmarSugestao(
  empresaId: string,
  conciliacaoId: string,
  tratamento: string | null,
  observacao: string | null,
): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const conc = await conciliacaoDaEmpresa(ctx, empresaId, conciliacaoId);
    if (!conc) return falha("Sugestão não encontrada.");
    if (conc.status !== "sugerida") return falha("Esta sugestão já foi tratada. Atualize a página.");
    const t = tratamento ? TRATAMENTO.safeParse(tratamento) : null;
    if (t && !t.success) return falha("Tratamento da diferença inválido.");
    const { error } = await ctx.supabase.rpc("confirmar_conciliacao", {
      p_conciliacao_id: conciliacaoId,
      p_tratamento: t?.data ?? undefined,
      p_observacao: observacao?.trim().slice(0, 500) || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conciliação confirmada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function rejeitarSugestao(empresaId: string, conciliacaoId: string, motivo: string | null): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const conc = await conciliacaoDaEmpresa(ctx, empresaId, conciliacaoId);
    if (!conc) return falha("Sugestão não encontrada.");
    const { error } = await ctx.supabase.rpc("rejeitar_sugestao_conciliacao", {
      p_conciliacao_id: conciliacaoId,
      p_motivo: motivo?.trim().slice(0, 500) || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Sugestão rejeitada. Este par não será sugerido novamente.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ conciliação manual
const listaUuid = (max: number) => z.array(z.string().regex(UUID, "Seleção inválida.")).max(max);

const esquemaManual = z
  .object({
    movimentos: listaUuid(50).min(1, "Selecione ao menos uma movimentação."),
    lancamentos: listaUuid(50).default([]),
    baixas: listaUuid(50).default([]),
    tratamento: TRATAMENTO.nullable().optional(),
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .refine((d) => d.lancamentos.length + d.baixas.length > 0, { path: ["lancamentos"], message: "Selecione os lançamentos ou pagamentos correspondentes." });

export async function conciliarManual(
  empresaId: string,
  entrada: { movimentos: string[]; lancamentos: string[]; baixas: string[]; tratamento?: string | null; observacao?: string | null },
): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const dados = esquemaManual.safeParse(entrada);
    if (!dados.success) return falhaValidacao(dados.error);
    const d = dados.data;
    if (!(await movimentosDaEmpresa(ctx, empresaId, d.movimentos))) return falha("Movimentação inválida para esta empresa.");
    const { error } = await ctx.supabase.rpc("conciliar_manual", {
      p_empresa_id: empresaId,
      p_movimentos: d.movimentos,
      p_lancamentos: d.lancamentos,
      p_baixas: d.baixas,
      p_tratamento: d.tratamento ?? undefined,
      p_observacao: d.observacao || undefined,
      p_tipo: "lancamento",
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(d.movimentos.length > 1 ? `${d.movimentos.length} movimentações conciliadas.` : "Movimentação conciliada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const esquemaTransferencia = z
  .object({
    movimentos: listaUuid(2).min(1, "Selecione a movimentação."),
    conta_contrapartida: uuidOpcional,
    transferencia_id: uuidOpcional,
    observacao: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((d, c) => {
    if (d.movimentos.length === 1 && !d.conta_contrapartida && !d.transferencia_id) {
      c.addIssue({ code: "custom", path: ["conta_contrapartida"], message: "Informe a outra conta da transferência." });
    }
  });

/** Transferência entre contas: 2 movimentações, 1 movimentação + outra conta, ou 1 movimentação + transferência já registrada. */
export async function conciliarTransferencia(
  empresaId: string,
  entrada: { movimentos: string[]; conta_contrapartida?: string | null; transferencia_id?: string | null; observacao?: string | null },
): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const dados = esquemaTransferencia.safeParse(entrada);
    if (!dados.success) return falhaValidacao(dados.error);
    const d = dados.data;
    if (!(await movimentosDaEmpresa(ctx, empresaId, d.movimentos))) return falha("Movimentação inválida para esta empresa.");
    const usarExistente = d.movimentos.length === 1 && d.transferencia_id;
    const { error } = await ctx.supabase.rpc("conciliar_manual", {
      p_empresa_id: empresaId,
      p_movimentos: d.movimentos,
      p_transferencias: usarExistente ? [d.transferencia_id!] : [],
      p_conta_contrapartida: d.movimentos.length === 1 && !usarExistente ? d.conta_contrapartida ?? undefined : undefined,
      p_observacao: d.observacao || undefined,
      p_tipo: "transferencia",
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(usarExistente ? "Movimentação conciliada com a transferência registrada." : "Transferência entre contas registrada e conciliada. Ela não é receita nem despesa.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const esquemaClassificar = z.object({
  movimento_id: z.string().regex(UUID, "Movimentação inválida."),
  categoria_id: z.string().regex(UUID, "Selecione a categoria."),
  descricao: textoOpcional,
  contraparte_id: uuidOpcional,
  data_competencia: dataOpcional,
});

/** Cria o lançamento (já pago) a partir da movimentação e concilia. */
export async function classificarMovimento(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!ctx.pode("financeiro.editar")) return falha("Para criar lançamentos é preciso também a permissão de editar o financeiro.");
    const dados = esquemaClassificar.safeParse({
      movimento_id: texto(fd, "movimento_id"),
      categoria_id: texto(fd, "categoria_id"),
      descricao: texto(fd, "descricao"),
      contraparte_id: texto(fd, "contraparte_id"),
      data_competencia: texto(fd, "data_competencia"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const d = dados.data;
    if (!(await movimentosDaEmpresa(ctx, empresaId, [d.movimento_id]))) return falha("Movimentação inválida para esta empresa.");
    const { error } = await ctx.supabase.rpc("classificar_movimento", {
      p_movimento_id: d.movimento_id,
      p_categoria_id: d.categoria_id,
      p_descricao: d.descricao ?? undefined,
      p_contraparte_id: d.contraparte_id ?? undefined,
      p_data_competencia: d.data_competencia ?? undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Lançamento criado e conciliado com a movimentação.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ ignorar / desfazer
export async function ignorarMovimento(empresaId: string, movimentoId: string, ignorar: boolean, motivo: string | null): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!(await movimentosDaEmpresa(ctx, empresaId, [movimentoId]))) return falha("Movimentação não encontrada.");
    if (ignorar && !motivo?.trim()) return falha("Informe por que esta movimentação será ignorada.");
    const { error } = await ctx.supabase.rpc("ignorar_movimento", {
      p_movimento_id: movimentoId,
      p_ignorar: ignorar,
      p_motivo: motivo?.trim().slice(0, 500) || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(ignorar ? "Movimentação ignorada. Ela não entra na conciliação." : "Movimentação reativada: voltou para as pendentes.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function desfazerConciliacao(empresaId: string, conciliacaoId: string, motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    const conc = await conciliacaoDaEmpresa(ctx, empresaId, conciliacaoId);
    if (!conc) return falha("Conciliação não encontrada.");
    if (!motivo?.trim()) return falha("Informe o motivo para desfazer a conciliação.");
    const { error } = await ctx.supabase.rpc("desfazer_conciliacao", { p_conciliacao_id: conciliacaoId, p_motivo: motivo.trim().slice(0, 500) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conciliação desfeita. Os pagamentos e transferências criados por ela foram removidos.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ saldos e finalização
const esquemaSaldo = z.object({
  conta_financeira_id: z.string().regex(UUID, "Selecione a conta."),
  data: dataObrigatoria("Informe a data do saldo."),
  saldo: valorMonetario({ obrigatorio: true }),
});

/** Saldo informado manualmente (ex.: extrato em PDF), usado na conferência. */
export async function informarSaldoExtrato(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!ctx.pode("financeiro.editar")) return falha("Para informar saldos é preciso a permissão de editar o financeiro.");
    const dados = esquemaSaldo.safeParse({
      conta_financeira_id: texto(fd, "conta_financeira_id"),
      data: texto(fd, "data"),
      saldo: texto(fd, "saldo"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const d = dados.data;
    // Um saldo manual por conta e dia: substitui o anterior.
    const { error: erroExcluir } = await ctx.supabase
      .from("extrato_saldos")
      .delete()
      .eq("empresa_id", empresaId)
      .eq("conta_financeira_id", d.conta_financeira_id)
      .eq("data", d.data)
      .eq("fonte", "manual");
    if (erroExcluir) return falha(mensagemErro(erroExcluir));
    const { error } = await ctx.supabase
      .from("extrato_saldos")
      .insert({ empresa_id: empresaId, conta_financeira_id: d.conta_financeira_id, data: d.data, saldo: Number(d.saldo), fonte: "manual" });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`Saldo do extrato informado: ${formatarMoeda(d.saldo)}.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/**
 * Conclui a etapa "Conciliação" do fechamento da competência, depois de
 * conferir que não há movimentações pendentes no mês. Diferenças de saldo
 * em relação ao extrato exigem justificativa (fica registrada na etapa).
 */
export async function concluirEtapaConciliacao(empresaId: string, competencia: string, justificativa: string | null): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!ctx.pode("fechamento.gerenciar")) return falha("Seu acesso não permite alterar o fechamento desta empresa.");
    const comp = lerCompetencia(competencia);
    if (!comp) return falha("Competência inválida.");
    const fim = ultimoDiaDoMes(comp);
    const [{ count, error: erroPend }, { data: saldos, error: erroSaldos }] = await Promise.all([
      ctx.supabase
        .from("movimentos_bancarios")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("status_conciliacao", "pendente")
        .gte("data", comp)
        .lte("data", fim),
      ctx.supabase.rpc("conferencia_saldos", { p_empresa_id: empresaId, p_inicio: comp, p_fim: fim }),
    ]);
    if (erroPend || erroSaldos) return falha(mensagemErro(erroPend ?? erroSaldos));
    const avaliacao = avaliarFinalizacao(count ?? 0, saldos ?? []);
    if (!avaliacao.pode) return falha(avaliacao.impedimentos.join(" "));
    const just = justificativa?.trim() ?? "";
    if (avaliacao.exigeJustificativa && just.length < 5) return falha("Há diferenças de saldo em relação ao extrato. Informe a justificativa para concluir.");

    const { data: competenciaId, error: erroInicio } = await ctx.supabase.rpc("iniciar_fechamento", { p_empresa_id: empresaId, p_competencia: comp });
    if (erroInicio) return falha(mensagemErro(erroInicio));
    const { data: etapa } = await ctx.supabase
      .from("fechamento_etapas")
      .select("id, status")
      .eq("empresa_id", empresaId)
      .eq("competencia_id", competenciaId as string)
      .eq("etapa", "conciliacao")
      .maybeSingle();
    if (!etapa) return falha("Etapa de conciliação não encontrada no fechamento.");
    if (etapa.status === "concluida") return sucesso("A etapa de conciliação desta competência já estava concluída.");
    const observacao = ["Conciliação bancária concluída pelo portal.", ...avaliacao.avisos, just ? `Justificativa: ${just}` : ""].filter(Boolean).join(" ").slice(0, 1000);
    const { error } = await ctx.supabase.rpc("atualizar_etapa_fechamento", { p_etapa_id: etapa.id, p_status: "concluida", p_observacao: observacao });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    revalidatePath(`/e/${empresaId}/fechamento`);
    return sucesso(`Etapa de conciliação de ${formatarCompetencia(comp)} concluída.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
