import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaDreBruta } from "@/lib/relatorios/dre";
import type { Database } from "@/lib/supabase/database.types";
import { buscarTudo } from "@/lib/supabase/paginar";
import { FORA_DA_DRE, type TipoCategoriaEscritorio } from "./comum";

type Cliente = SupabaseClient<Database>;

export interface LancamentoDre {
  id: string;
  natureza: string;
  data: string;
  competencia: string;
  descricao: string;
  valor: number;
  empresa_id: string | null;
  categoria: { id: string; codigo: string; nome: string; tipo: string } | null;
}

/**
 * Lançamentos do período, pelo mês do serviço (competência) ou pelo mês em
 * que o dinheiro entrou ou saiu (caixa). Os sem linha da DRE ficam de fora
 * (contados à parte como "a classificar").
 */
export async function lancamentosDoPeriodo(supabase: Cliente, inicio: string, fim: string, base: "competencia" | "caixa") {
  const campo = base === "caixa" ? "data" : "competencia";
  const linhas = await buscarTudo((de, ate) =>
    supabase
      .from("escritorio_lancamentos")
      .select("id, natureza, data, competencia, descricao, valor, empresa_id, categoria:escritorio_categorias(id, codigo, nome, tipo)")
      .gte(campo, inicio)
      .lte(campo, fim)
      .order(campo)
      .range(de, ate),
  );
  return (linhas as unknown as LancamentoDre[]).map((l) => ({ ...l, valor: Number(l.valor) }));
}

export function linhasDre(lancamentos: LancamentoDre[], base: "competencia" | "caixa"): LinhaDreBruta[] {
  return lancamentos
    .filter((l) => l.categoria && !FORA_DA_DRE.includes(l.categoria.tipo as TipoCategoriaEscritorio))
    .map((l) => ({
      mes: (base === "caixa" ? l.data : l.competencia).slice(0, 8) + "01",
      origem: "lancamento",
      categoria_id: l.categoria!.id,
      categoria_codigo: l.categoria!.codigo,
      categoria_nome: l.categoria!.nome,
      tipo: l.categoria!.tipo,
      valor: l.valor,
    }));
}

/** Movimentos fora da DRE (retirada e dinheiro dos sócios, investimentos), por linha. */
export function foraDaDre(lancamentos: LancamentoDre[]) {
  const mapa = new Map<string, { codigo: string; nome: string; tipo: string; total: number }>();
  for (const l of lancamentos) {
    if (!l.categoria || !FORA_DA_DRE.includes(l.categoria.tipo as TipoCategoriaEscritorio)) continue;
    const atual = mapa.get(l.categoria.id) ?? { codigo: l.categoria.codigo, nome: l.categoria.nome, tipo: l.categoria.tipo, total: 0 };
    atual.total += l.valor;
    mapa.set(l.categoria.id, atual);
  }
  return [...mapa.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
}

/** Receita por cliente no período (honorários, extras, avulsos e juros), do maior para o menor. */
export function receitaPorCliente(lancamentos: LancamentoDre[], nomes: Map<string, string>) {
  const mapa = new Map<string, { nome: string; total: number }>();
  for (const l of lancamentos) {
    if (!l.categoria || l.natureza !== "receita" || FORA_DA_DRE.includes(l.categoria.tipo as TipoCategoriaEscritorio)) continue;
    const chave = l.empresa_id ?? "sem";
    const atual = mapa.get(chave) ?? { nome: l.empresa_id ? (nomes.get(l.empresa_id) ?? "Empresa") : "Sem cliente / avulsos", total: 0 };
    atual.total += l.valor;
    mapa.set(chave, atual);
  }
  return [...mapa.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total);
}
