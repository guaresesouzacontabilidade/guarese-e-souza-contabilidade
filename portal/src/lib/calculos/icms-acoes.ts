"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { lerValorBR } from "@/lib/dinheiro";
import { VERSAO_LEITURA } from "@/lib/fiscal/xml";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { DESTINACOES, TIPOS_LANCAMENTO_ICMS, resultadoParaGuardar, type Destinacao, type TipoLancamentoIcms } from "./icms";
import { carregarIcms } from "./icms-carregar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, nome: string) => String(fd.get(nome) ?? "").trim();

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/calculos`, "layout");
  revalidatePath("/escritorio/icms");
}

/** Destinação de uma nota, de um item ou de um fornecedor (vazio = volta ao padrão). */
export async function definirDestinacao(
  empresaId: string,
  alvo: { notaId?: string | null; item?: number | null; fornecedor?: string | null },
  destinacao: string | null,
): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  if (alvo.notaId && !UUID.test(alvo.notaId)) return falha("Nota inválida.");
  if (destinacao && !(destinacao in DESTINACOES)) return falha("Destinação inválida.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const { error } = await ctx.supabase.rpc("icms_definir_destinacao", {
    p_empresa_id: empresaId,
    // Nulos são aceitos pela função (nota ou fornecedor; destinação vazia volta ao padrão)
    p_documento_fiscal_id: (alvo.notaId ?? null) as never,
    p_numero_item: (alvo.item ?? null) as never,
    p_fornecedor: (alvo.fornecedor ?? null) as never,
    p_destinacao: (destinacao || null) as never,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  const rotulo = destinacao ? DESTINACOES[destinacao as Destinacao].nome.toLowerCase() : "a destinação padrão";
  return sucesso(alvo.fornecedor ? `Notas deste fornecedor: ${rotulo}.` : `Destinação: ${rotulo}.`);
}

export async function definirDestinacaoPadrao(empresaId: string, destinacao: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  if (destinacao !== "revenda" && destinacao !== "uso_consumo") return falha("Destinação inválida.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const { error } = await ctx.supabase.rpc("icms_definir_destinacao_padrao", { p_empresa_id: empresaId, p_destinacao: destinacao });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(`Compras da empresa, por padrão: ${DESTINACOES[destinacao].nome.toLowerCase()}.`);
}

export async function adicionarLancamentoIcms(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const tipo = texto(fd, "tipo") as TipoLancamentoIcms;
  const descricao = texto(fd, "descricao");
  const valor = lerValorBR(texto(fd, "valor"));
  const observacao = texto(fd, "observacao");
  const erros: Record<string, string[]> = {};
  if (!(tipo in TIPOS_LANCAMENTO_ICMS)) erros.tipo = ["Escolha o tipo."];
  if (descricao.length < 3 || descricao.length > 120) erros.descricao = ["Descreva em 3 a 120 letras."];
  if (!valor || valor.lte(0)) erros.valor = ["Informe um valor maior que zero."];
  if (observacao.length > 500) erros.observacao = ["Até 500 letras."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.from("icms_lancamentos").insert({
    empresa_id: empresaId,
    competencia: comp,
    tipo,
    descricao,
    valor: Number(valor!.toFixed(2)),
    observacao: observacao || null,
  });
  if (error) return falha(error.code === "42501" ? "O mês já foi conferido: reabra a apuração para lançar." : mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Valor lançado na apuração.");
}

export async function removerLancamentoIcms(empresaId: string, id: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(id)) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const { data, error } = await ctx.supabase.from("icms_lancamentos").delete().eq("id", id).eq("empresa_id", empresaId).select("id");
  if (error) return falha(mensagemErro(error));
  if (!data?.length) return falha("Não foi possível remover: o mês pode já ter sido conferido.");
  revalidar(empresaId);
  return sucesso("Valor removido.");
}

/** Saldo credor do mês anterior (vazio = automático, pela conferência do mês anterior). */
export async function informarSaldoAnterior(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const bruto = texto(fd, "saldo");
  const valor = bruto ? lerValorBR(bruto) : null;
  if (bruto && (!valor || valor.lt(0))) return falha("Informe um saldo de zero para cima.", { saldo: ["Valor inválido."] });
  const { error } = await ctx.supabase.rpc("icms_informar_saldo_anterior", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_valor: (valor ? Number(valor.toFixed(2)) : null) as number,
    p_observacao: texto(fd, "observacao") || undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(valor ? "Saldo credor anterior informado." : "Saldo credor anterior: automático (conferência do mês anterior).");
}

/** Conferência: recalcula no servidor e guarda o resultado do mês. */
export async function conferirIcms(empresaId: string, competencia: string): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const r = await carregarIcms(ctx.supabase, empresaId, comp);
  if ("erro" in r) return falha(r.erro);
  if (r.resultado.modo === "sem_regime" || r.resultado.modo === "nao_contribuinte") return falha(r.resultado.mensagem ?? "Apuração indisponível.");
  const { error } = await ctx.supabase.rpc("icms_conferir", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_resultado: resultadoParaGuardar(r.resultado) as never,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Apuração do ICMS conferida. Os valores ficam guardados e a previsão do cliente passa a usá-los.");
}

export async function reabrirIcms(empresaId: string, competencia: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const motivo = texto(fd, "motivo");
  if (motivo.length < 5) return falha("Informe o motivo.", { motivo: ["Informe o motivo (pelo menos 5 letras)."] });
  const { error } = await ctx.supabase.rpc("icms_reabrir", { p_empresa_id: empresaId, p_competencia: comp, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Apuração reaberta. Ajuste o que precisar e confira de novo.");
}

/** Relê as notas do mês gravadas com a leitura anterior (frete por item, crédito do Simples...). */
export async function relerNotasIcms(empresaId: string, competencia: string): Promise<ResultadoAcao> {
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const ctx = await exigirPermissao(empresaId, "calculos.gerenciar");
  const { data, error } = await ctx.supabase.rpc("icms_reler_notas", { p_empresa_id: empresaId, p_competencia: comp, p_versao_leitura: VERSAO_LEITURA });
  if (error) return falha(mensagemErro(error));
  if (!data) return sucesso("Todas as notas do mês já estão com a leitura atual.");
  processarFilaDepois({ tipos: ["reler_notas_mes"] });
  revalidar(empresaId);
  return sucesso(`Releitura de ${data} ${data === 1 ? "nota" : "notas"} iniciada. Em instantes, atualize a página.`);
}
