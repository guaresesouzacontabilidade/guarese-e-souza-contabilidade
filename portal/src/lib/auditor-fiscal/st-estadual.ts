import type { Fonte } from "@/lib/calculos/tabelas";

export type SegmentoExclusaoSt = "bebidas_frias" | "tintas_vernizes" | "higiene_cosmeticos";

/**
 * Linha da lista de produtos que saíram da substituição tributária por regra
 * do Estado (tabela auditor_st_exclusoes). Hoje: Tocantins, Decreto nº
 * 6.996/2025 e alterações — fora da ST só a venda INTERNA da indústria
 * fabricante do próprio Estado; a compra de outro estado continua com ST.
 */
export interface ExclusaoSt {
  uf: string;
  item: string;
  segmento: SegmentoExclusaoSt;
  /** Prefixo do CEST, só dígitos. */
  cest: string;
  ncm: string | null;
  descricao: string;
  condicao: string | null;
  somente_fabricante_uf: boolean;
  confianca: "alta" | "conferir";
  fonte: Fonte;
  inicio: string;
  fim: string | null;
}

export const ROTULO_SEGMENTO_ST: Record<SegmentoExclusaoSt, string> = {
  bebidas_frias: "bebidas frias",
  tintas_vernizes: "tintas e vernizes",
  higiene_cosmeticos: "higiene pessoal",
};

export const somenteDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/**
 * Exclusão estadual que alcança o produto (pelo CEST e, quando a linha pede,
 * pelo NCM) na data informada; vale a linha mais específica.
 */
export function exclusaoSt(cest: string | null, ncm: string | null, data: string, uf: string | null, linhas: ExclusaoSt[]): ExclusaoSt | null {
  const c = somenteDigitos(cest);
  if (!uf || c.length !== 7) return null;
  const n = ncm ?? "";
  const vigentes = linhas.filter(
    (l) => l.uf === uf && c.startsWith(l.cest) && (!l.ncm || n.startsWith(l.ncm)) && l.inicio <= data && (!l.fim || l.fim >= data),
  );
  return vigentes.sort((a, b) => b.cest.length - a.cest.length || (b.ncm?.length ?? 0) - (a.ncm?.length ?? 0))[0] ?? null;
}
