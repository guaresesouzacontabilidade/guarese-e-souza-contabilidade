"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}`, "layout");
}

/** "Paguei": registra a data, o valor e o comprovante (já enviado pelo portal) da guia. */
export async function informarPagamento(
  empresaId: string,
  guiaId: string,
  dados: { pagoEm: string; valor?: string | null; comprovanteId?: string | null; observacao?: string | null },
): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(guiaId)) return falha("Guia inválida.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dados.pagoEm)) return falha("Informe a data do pagamento.");
  if (dados.comprovanteId && !UUID.test(dados.comprovanteId)) return falha("Comprovante inválido.");
  let valor: string | null = null;
  if (dados.valor) {
    const v = lerValorBR(dados.valor);
    if (!v || v.lte(0)) return falha("Valor inválido.");
    valor = v.toFixed(2);
  }
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.enviar")) return falha("Você não tem permissão para informar pagamentos.");
  const { error } = await ctx.supabase.rpc("informar_pagamento_guia", {
    p_guia_id: guiaId,
    p_pago_em: dados.pagoEm,
    p_valor: valor as unknown as number,
    p_comprovante_id: (dados.comprovanteId || null) as unknown as string,
    p_observacao: (dados.observacao?.slice(0, 500) || null) as unknown as string,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(dados.comprovanteId ? "Pagamento informado. O escritório recebeu o comprovante." : "Pagamento informado. Envie o comprovante quando puder.");
}

export async function desfazerPagamento(empresaId: string, guiaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(guiaId)) return falha("Guia inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("desfazer_pagamento_guia", { p_guia_id: guiaId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Pagamento desfeito.");
}
