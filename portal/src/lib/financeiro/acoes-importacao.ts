"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import type { Mapeamento } from "@/lib/extratos/planilha";
import {
  analisarArquivo,
  aplicarMapeamentoLancamentos,
  lerDocumentoParaImportacao,
  prepararExtrato,
  type LinhaLancamentoImportada,
  type MapeamentoLancamentos,
  type PreviaExtrato,
} from "./importacao";
import { processarFilaDepois } from "@/lib/jobs/disparo";

const UUID = /^[0-9a-f-]{36}$/i;

async function contexto(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.importar")) throw new Error("Seu acesso não permite importar extratos e planilhas.");
  return ctx;
}

function validarMapeamento(m: unknown): Mapeamento | null {
  if (!m || typeof m !== "object") return null;
  const x = m as Record<string, unknown>;
  const col = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) < 200 ? Number(v) : null);
  return {
    linhaCabecalho: Number.isInteger(Number(x.linhaCabecalho)) ? Math.max(-1, Math.min(1000, Number(x.linhaCabecalho))) : -1,
    data: col(x.data),
    descricao: col(x.descricao),
    complemento: col(x.complemento),
    documento: col(x.documento),
    valor: col(x.valor),
    debito: col(x.debito),
    credito: col(x.credito),
    tipo: col(x.tipo),
    saldo: col(x.saldo),
    inverterSinal: Boolean(x.inverterSinal),
  };
}

export async function previaExtrato(
  empresaId: string,
  documentoId: string,
  contaId: string | null,
  mapeamento: unknown,
): Promise<ResultadoAcao<PreviaExtrato>> {
  try {
    const ctx = await contexto(empresaId);
    if (!UUID.test(documentoId)) return falha("Documento inválido.");
    const arq = await lerDocumentoParaImportacao(ctx, empresaId, documentoId);
    const analise = await analisarArquivo(arq);
    const { previa } = await prepararExtrato(ctx, analise, validarMapeamento(mapeamento), contaId && UUID.test(contaId) ? contaId : null);
    return sucesso(undefined, previa);
  } catch (e) {
    return falha(e instanceof Error ? e.message : mensagemErro(e));
  }
}

export async function confirmarImportacaoExtrato(
  empresaId: string,
  documentoId: string,
  contaId: string,
  mapeamento: unknown,
): Promise<ResultadoAcao<{ importacaoId: string; novas: number; duplicadas: number; periodoFechado: number; invalidas: number; reenvio: boolean }>> {
  try {
    const ctx = await contexto(empresaId);
    if (!UUID.test(documentoId) || !UUID.test(contaId)) return falha("Escolha o arquivo e a conta.");
    const arq = await lerDocumentoParaImportacao(ctx, empresaId, documentoId);
    const analise = await analisarArquivo(arq);
    const m = analise.tipo === "planilha" ? validarMapeamento(mapeamento) ?? analise.mapeamento : null;
    const { transacoes, invalidas, previa } = await prepararExtrato(ctx, analise, m, contaId);
    if (!transacoes.length) return falha("Nenhuma movimentação válida para importar. Revise o mapeamento das colunas.");
    // A mesma combinação arquivo + conta + mapeamento devolve o resultado anterior (sem duplicar).
    const chave = createHash("sha256").update(`${arq.sha256 ?? arq.id}|${contaId}|${JSON.stringify(m)}`).digest("hex");
    const { data, error } = await ctx.supabase.rpc("importar_extrato", {
      p_empresa_id: empresaId,
      p_conta_id: contaId,
      p_tipo: analise.tipo === "ofx" ? "extrato_ofx" : "extrato_planilha",
      p_chave_idempotencia: chave,
      p_arquivo_nome: arq.nome,
      p_arquivo_sha256: arq.sha256 ?? "",
      p_documento_id: arq.id,
      p_mapeamento: (m ?? {}) as never,
      p_linhas: transacoes.map((t) => ({ data: t.data, valor: t.valor, descricao: t.descricao, documento: t.documento, tipo: t.tipo, numero: t.numero, fitid: t.fitid, ocorrencia: t.ocorrencia })) as never,
      p_saldo_final: previa.saldoFinal?.valor ? (previa.saldoFinal.valor as unknown as number) : undefined,
      p_data_saldo_final: previa.saldoFinal?.data ?? undefined,
      p_total_invalidas: invalidas.length,
      p_erros: invalidas.slice(0, 200) as never,
    });
    if (error) return falha(mensagemErro(error));
    const r = data as unknown as { importacao_id: string; novas: number; duplicadas: number; periodo_fechado: number; invalidas: number; reenvio: boolean };
    processarFilaDepois({ tipos: ["sugerir_conciliacao"] });
    revalidatePath(`/e/${empresaId}/financeiro`, "layout");
    revalidatePath(`/e/${empresaId}/conciliacao`);
    return sucesso(r.reenvio ? "Este arquivo já havia sido importado nesta conta — nada foi duplicado." : `${r.novas} movimentação(ões) importada(s).`, {
      importacaoId: r.importacao_id,
      novas: r.novas,
      duplicadas: r.duplicadas,
      periodoFechado: r.periodo_fechado,
      invalidas: r.invalidas,
      reenvio: r.reenvio,
    });
  } catch (e) {
    return falha(e instanceof Error ? e.message : mensagemErro(e));
  }
}

function validarMapeamentoLanc(m: unknown): MapeamentoLancamentos | null {
  if (!m || typeof m !== "object") return null;
  const x = m as Record<string, unknown>;
  const col = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) < 200 ? Number(v) : null);
  return {
    linhaCabecalho: Number.isInteger(Number(x.linhaCabecalho)) ? Math.max(-1, Math.min(1000, Number(x.linhaCabecalho))) : -1,
    tipo: col(x.tipo),
    tipoFixo: x.tipoFixo === "receber" || x.tipoFixo === "pagar" ? x.tipoFixo : null,
    descricao: col(x.descricao),
    data_competencia: col(x.data_competencia),
    data_vencimento: col(x.data_vencimento),
    valor: col(x.valor),
    categoria: col(x.categoria),
    contraparte_nome: col(x.contraparte_nome),
    contraparte_documento: col(x.contraparte_documento),
    numero_documento: col(x.numero_documento),
    data_pagamento: col(x.data_pagamento),
    valor_pago: col(x.valor_pago),
  };
}

export async function previaLancamentos(
  empresaId: string,
  documentoId: string,
  mapeamento: unknown,
): Promise<ResultadoAcao<{ total: number; invalidas: { linha: number; motivo: string; conteudo?: string }[]; amostra: LinhaLancamentoImportada[]; receber: number; pagar: number; semCategoria: number }>> {
  try {
    const ctx = await contexto(empresaId);
    const arq = await lerDocumentoParaImportacao(ctx, empresaId, documentoId);
    const analise = await analisarArquivo(arq);
    if (analise.tipo !== "planilha") return falha("Para importar contas a pagar/receber, use uma planilha (CSV ou XLSX).");
    const m = validarMapeamentoLanc(mapeamento);
    if (!m) return falha("Mapeamento inválido.");
    const { validas, invalidas } = aplicarMapeamentoLancamentos(analise.linhas, m);
    const { data: cats } = await ctx.supabase.from("categorias_financeiras").select("codigo, nome").eq("empresa_id", empresaId).eq("sintetica", false).eq("ativa", true);
    const conhecidas = new Set((cats ?? []).flatMap((c) => [c.codigo.toLowerCase(), c.nome.toLowerCase()]));
    return sucesso(undefined, {
      total: validas.length,
      invalidas: invalidas.slice(0, 100),
      amostra: validas.slice(0, 100),
      receber: validas.filter((v) => v.tipo === "receber").length,
      pagar: validas.filter((v) => v.tipo === "pagar").length,
      semCategoria: validas.filter((v) => !v.categoria_codigo || !conhecidas.has(v.categoria_codigo.toLowerCase())).length,
    });
  } catch (e) {
    return falha(e instanceof Error ? e.message : mensagemErro(e));
  }
}

export async function confirmarImportacaoLancamentos(
  empresaId: string,
  documentoId: string,
  mapeamento: unknown,
  contaPagamentosId: string | null,
): Promise<ResultadoAcao<{ importacaoId: string; novas: number; duplicadas: number }>> {
  try {
    const ctx = await contexto(empresaId);
    if (!ctx.pode("financeiro.editar")) return falha("É preciso permissão para editar o financeiro.");
    const arq = await lerDocumentoParaImportacao(ctx, empresaId, documentoId);
    const analise = await analisarArquivo(arq);
    if (analise.tipo !== "planilha") return falha("Use uma planilha (CSV ou XLSX).");
    const m = validarMapeamentoLanc(mapeamento);
    if (!m) return falha("Mapeamento inválido.");
    const { validas, invalidas } = aplicarMapeamentoLancamentos(analise.linhas, m);
    if (!validas.length) return falha("Nenhuma linha válida para importar.");
    const conta = contaPagamentosId && UUID.test(contaPagamentosId) ? contaPagamentosId : null;
    const chave = createHash("sha256").update(`lanc|${arq.sha256 ?? arq.id}|${JSON.stringify(m)}|${conta ?? ""}`).digest("hex");
    const { data, error } = await ctx.supabase.rpc("importar_lancamentos", {
      p_empresa_id: empresaId,
      p_chave_idempotencia: chave,
      p_arquivo_nome: arq.nome,
      p_arquivo_sha256: arq.sha256 ?? "",
      p_documento_id: arq.id,
      p_mapeamento: m as never,
      p_linhas: validas.map((v) => ({ ...v, conta_id: conta })) as never,
      p_total_invalidas: invalidas.length,
      p_erros: invalidas.slice(0, 200) as never,
    });
    if (error) return falha(mensagemErro(error));
    const r = data as unknown as { importacao_id: string; novas: number; duplicadas: number; reenvio: boolean };
    revalidatePath(`/e/${empresaId}/financeiro`, "layout");
    return sucesso(r.reenvio ? "Esta planilha já havia sido importada — nada foi duplicado." : `${r.novas} lançamento(s) importado(s). Sem categoria reconhecida, ficam como sugeridos para revisão.`, {
      importacaoId: r.importacao_id,
      novas: r.novas,
      duplicadas: r.duplicadas,
    });
  } catch (e) {
    return falha(e instanceof Error ? e.message : mensagemErro(e));
  }
}

export async function desfazerImportacao(empresaId: string, importacaoId: string, motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contexto(empresaId);
    if (!motivo.trim()) return falha("Informe o motivo.");
    const { data, error } = await ctx.supabase.rpc("desfazer_importacao", { p_importacao_id: importacaoId, p_motivo: motivo });
    if (error) return falha(mensagemErro(error));
    revalidatePath(`/e/${empresaId}/financeiro`, "layout");
    revalidatePath(`/e/${empresaId}/conciliacao`);
    return sucesso(`Importação desfeita (${(data as { removidos?: number } | null)?.removidos ?? 0} registro(s) removido(s)). O histórico foi mantido.`);
  } catch (e) {
    return falha(e instanceof Error ? e.message : mensagemErro(e));
  }
}
