"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { atualizarTelasDaEmpresa } from "@/lib/atualizar-telas";

/**
 * Ações dos títulos (contas a pagar e a receber) da etapa 1 do Financeiro:
 * aprovação, baixa e alterações em lote, renegociação, recorrência e faixas
 * de aprovação. O banco confere a permissão e a empresa em cada operação.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function ids(lista: string[]) {
  return [...new Set(lista.filter((i) => UUID.test(i)))];
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/financeiro`, "layout");
  atualizarTelasDaEmpresa(empresaId);
}

async function contexto(empresaId: string, permissao: string, mensagem: string) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode(permissao as never)) throw new Error(mensagem);
  return ctx;
}

// ------------------------------------------------------------------ aprovação
export async function salvarFaixasAprovacao(empresaId: string, faixas: { valor_minimo: string; aprovacoes: number }[]): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "financeiro.aprovar", "Só quem aprova pagamentos pode mudar as faixas de aprovação.");
    const limpas: { valor_minimo: number; aprovacoes: number }[] = [];
    for (const [i, f] of faixas.entries()) {
      const valor = Number(String(f.valor_minimo).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) return falha(`Faixa ${i + 1}: informe o valor mínimo (ex.: 1.000,00).`);
      const aprovacoes = Math.min(3, Math.max(1, Math.round(Number(f.aprovacoes) || 1)));
      limpas.push({ valor_minimo: Math.round(valor * 100) / 100, aprovacoes });
    }
    const { data, error } = await ctx.supabase.rpc("financeiro_aprovacao_salvar", { p_empresa_id: empresaId, p_faixas: limpas });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    if (!limpas.length) return sucesso("Aprovação desligada: os pagamentos não precisam mais de aprovação.");
    return sucesso(`Faixas de aprovação salvas. ${data ?? 0} pagamento(s) em aberto conferido(s) com as novas faixas.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function decidirAprovacao(empresaId: string, lista: string[], decisao: "aprovado" | "reprovado", justificativa?: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "financeiro.aprovar", "Você não tem permissão para aprovar pagamentos nesta empresa.");
    const alvo = ids(lista);
    if (!alvo.length) return falha("Selecione ao menos um pagamento.");
    const { data, error } = await ctx.supabase.rpc("financeiro_aprovar", {
      p_empresa_id: empresaId,
      p_ids: alvo,
      p_decisao: decisao,
      p_justificativa: justificativa?.trim() || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(decisao === "aprovado" ? `${data} pagamento(s) aprovado(s).` : `${data} pagamento(s) reprovado(s).`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ lote
export async function baixarEmLote(
  empresaId: string,
  lista: string[],
  dados: { data: string; contaId: string; forma?: string; chave: string },
): Promise<ResultadoAcao<{ quantidade: number; total: number }>> {
  try {
    const ctx = await contexto(empresaId, "financeiro.baixar", "Você não tem permissão para registrar pagamentos e recebimentos nesta empresa.");
    const alvo = ids(lista);
    if (!alvo.length) return falha("Selecione ao menos um título.");
    if (!DATA.test(dados.data)) return falha("Informe a data do pagamento.", { data: ["Informe a data."] });
    if (!UUID.test(dados.contaId)) return falha("Escolha a conta.", { conta: ["Escolha a conta de onde saiu ou para onde entrou o dinheiro."] });
    const { data, error } = await ctx.supabase.rpc("financeiro_baixar_lote", {
      p_empresa_id: empresaId,
      p_ids: alvo,
      p_data: dados.data,
      p_conta_id: dados.contaId,
      p_forma: dados.forma || undefined,
      p_chave: UUID.test(dados.chave) ? dados.chave : undefined,
    });
    if (error) return falha(mensagemErro(error));
    const r = data as { quantidade: number; total: number };
    revalidar(empresaId);
    return sucesso(`${r.quantidade} título(s) baixado(s), total de ${formatarMoeda(r.total)}.`, r);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function alterarEmLote(empresaId: string, lista: string[], acao: "vencimento" | "categoria" | "centro_custo" | "cancelar", valor: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "financeiro.editar", "Você não tem permissão para alterar títulos nesta empresa.");
    const alvo = ids(lista);
    if (!alvo.length) return falha("Selecione ao menos um título.");
    if (acao === "vencimento" && !DATA.test(valor)) return falha("Informe o novo vencimento.");
    if (acao === "categoria" && !UUID.test(valor)) return falha("Escolha a conta do plano de contas.");
    if (acao === "centro_custo" && valor && !UUID.test(valor)) return falha("Centro de custo inválido.");
    if (acao === "cancelar" && valor.trim().length < 3) return falha("Informe o motivo do cancelamento.");
    const { data, error } = await ctx.supabase.rpc("financeiro_lote_alterar", { p_empresa_id: empresaId, p_ids: alvo, p_acao: acao, p_valor: valor });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    const o = { vencimento: "com vencimento alterado", categoria: "com a conta alterada", centro_custo: "com o centro de custo alterado", cancelar: "cancelado(s)" }[acao];
    return sucesso(`${data} título(s) ${o}.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ renegociação
export async function renegociarTitulos(
  empresaId: string,
  lista: string[],
  parcelas: { vencimento: string; valor: string }[],
  motivo: string,
  descricao?: string,
): Promise<ResultadoAcao<{ id: string }>> {
  try {
    const ctx = await contexto(empresaId, "financeiro.editar", "Você não tem permissão para renegociar títulos nesta empresa.");
    const alvo = ids(lista);
    if (!alvo.length) return falha("Escolha os títulos a renegociar.");
    if (motivo.trim().length < 5) return falha("Explique o motivo da renegociação.", { motivo: ["Ao menos 5 letras."] });
    const limpas: { vencimento: string; valor: number }[] = [];
    for (const [i, p] of parcelas.entries()) {
      const valor = Number(String(p.valor).replace(/\./g, "").replace(",", "."));
      if (!DATA.test(p.vencimento)) return falha(`Parcela ${i + 1}: informe o vencimento.`);
      if (!Number.isFinite(valor) || valor <= 0) return falha(`Parcela ${i + 1}: informe o valor.`);
      limpas.push({ vencimento: p.vencimento, valor: Math.round(valor * 100) / 100 });
    }
    const { data, error } = await ctx.supabase.rpc("financeiro_renegociar", {
      p_empresa_id: empresaId,
      p_lancamentos: alvo,
      p_parcelas: limpas,
      p_motivo: motivo,
      p_descricao: descricao?.trim() || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`Renegociação registrada: ${limpas.length} parcela(s) nova(s). Os títulos originais ficaram no histórico como renegociados.`, { id: data as string });
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function desfazerRenegociacao(empresaId: string, renegociacaoId: string, motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "financeiro.editar", "Você não tem permissão para desfazer renegociações nesta empresa.");
    if (!UUID.test(renegociacaoId)) return falha("Renegociação inválida.");
    const { error } = await ctx.supabase.rpc("financeiro_desfazer_renegociacao", { p_empresa_id: empresaId, p_renegociacao_id: renegociacaoId, p_motivo: motivo });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Renegociação desfeita: os títulos originais voltaram a ficar em aberto e as parcelas do acordo foram retiradas.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ recorrência
export async function alterarOcorrencia(
  empresaId: string,
  lancamentoId: string,
  escopo: "esta" | "proximas" | "encerrar",
  dados: { descricao?: string; valor?: string; data_vencimento?: string },
): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId, "financeiro.editar", "Você não tem permissão para alterar títulos nesta empresa.");
    if (!UUID.test(lancamentoId)) return falha("Título inválido.");
    const p: Record<string, string | number> = {};
    if (dados.descricao?.trim()) p.descricao = dados.descricao.trim();
    if (dados.valor?.trim()) {
      const valor = Number(dados.valor.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) return falha("Informe um valor maior que zero.", { valor: ["Informe o valor."] });
      p.valor = Math.round(valor * 100) / 100;
    }
    if (dados.data_vencimento) {
      if (!DATA.test(dados.data_vencimento)) return falha("Data inválida.");
      p.data_vencimento = dados.data_vencimento;
    }
    if (escopo !== "encerrar" && !Object.keys(p).length) return falha("Mude o valor, a descrição ou o vencimento antes de salvar.");
    const { data, error } = await ctx.supabase.rpc("financeiro_recorrencia_alterar", { p_empresa_id: empresaId, p_lancamento_id: lancamentoId, p_escopo: escopo, p_dados: p });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    if (escopo === "esta") return sucesso("Só esta ocorrência foi alterada.");
    if (escopo === "proximas") return sucesso(`Esta e as próximas foram alteradas (${data} título(s) em aberto). A recorrência segue com os novos dados.`);
    return sucesso(`Recorrência encerrada a partir desta: ${data} título(s) em aberto cancelado(s).`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
