import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { diasAtras } from "./contexto";
import { carregarProdutosLoja } from "./dados";
import type { ProdutoAnalise, VendaProduto } from "./analise-estoque";

type Cliente = ContextoEmpresa["supabase"];

export const PERIODOS = [30, 60, 90] as const;
export const ALVOS = [15, 30, 45, 60, 90] as const;
export const LIMITES_PARADO = [60, 90, 180] as const;

/** Lê um número da URL entre as opções aceitas (senão, o padrão). */
export function opcao<T extends number>(valor: unknown, opcoes: readonly T[], padrao: T): T {
  const n = Number(typeof valor === "string" ? valor : NaN);
  return (opcoes as readonly number[]).includes(n) ? (n as T) : padrao;
}

/**
 * Dados da reposição e análise: produtos ativos, vendas por produto no período
 * (e a última venda de cada um) e a última entrada no estoque. As funções do
 * banco só respondem para quem gerencia a loja da empresa.
 */
export async function carregarAnaliseEstoque(supabase: Cliente, empresaId: string, dias: number) {
  const hoje = diasAtras(0);
  const inicio = diasAtras(dias - 1);
  const [produtos, { data: vendas, error }, { data: situacao }] = await Promise.all([
    carregarProdutosLoja(supabase, empresaId, { ativos: true, custos: true }),
    supabase.rpc("gestao_vendas_por_produto", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: hoje }),
    supabase.rpc("gestao_precos_situacao", { p_empresa_id: empresaId }),
  ]);
  if (error) throw new Error(error.message);
  const s = (v: unknown) => (v === null || v === undefined ? "0" : String(v));
  return {
    hoje,
    inicio,
    produtos: produtos as ProdutoAnalise[],
    vendas: new Map<string, VendaProduto>(
      (vendas ?? []).map((v) => [
        v.produto_id,
        { produto_id: v.produto_id, quantidade: s(v.quantidade), faturamento: s(v.faturamento), custo: s(v.custo), vendas: Number(v.vendas ?? 0), ultima_venda: v.ultima_venda ?? null },
      ]),
    ),
    ultimaEntrada: new Map<string, string | null>((situacao ?? []).map((x) => [x.produto_id, x.ultima_entrada_em ?? null])),
  };
}
