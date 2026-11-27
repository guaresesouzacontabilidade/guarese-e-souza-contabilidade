import type { Fonte } from "@/lib/calculos/tabelas";

export type GrupoMonofasico =
  | "farmaceuticos"
  | "higiene_perfumaria"
  | "veiculos_maquinas"
  | "autopecas"
  | "pneus"
  | "bebidas_frias"
  | "combustiveis";

/** Linha do catálogo de produtos com PIS/Cofins monofásico (tabela auditor_ncm_monofasico). */
export interface LinhaCatalogo {
  ncm: string;
  ex: string | null;
  excecao: boolean;
  grupo: GrupoMonofasico;
  descricao: string;
  condicao: string | null;
  somente_varejo: boolean;
  confianca: "alta" | "conferir";
  fonte: Fonte;
  inicio: string;
  fim: string | null;
}

export const ROTULO_GRUPO: Record<GrupoMonofasico | "compra_cst04", string> = {
  farmaceuticos: "medicamentos",
  higiene_perfumaria: "perfumaria e higiene",
  veiculos_maquinas: "veículos e máquinas",
  autopecas: "autopeças",
  pneus: "pneus e câmaras",
  bebidas_frias: "bebidas frias",
  combustiveis: "combustíveis",
  compra_cst04: "produtos comprados como monofásicos (CST 04)",
};

function exIgual(a: string | null, b: string | null) {
  if (a === null) return true;
  return b !== null && Number(a) === Number(b);
}

/**
 * Enquadramento de um NCM no catálogo, na data informada: vale a linha de
 * prefixo mais longo; uma linha de exceção que alcance o código o exclui.
 */
export function classificarNcm(ncm: string | null, ex: string | null, data: string, linhas: LinhaCatalogo[]): LinhaCatalogo | null {
  if (!ncm || !/^\d{8}$/.test(ncm)) return null;
  const vigentes = linhas.filter((l) => ncm.startsWith(l.ncm) && l.inicio <= data && (!l.fim || l.fim >= data));
  if (vigentes.some((l) => l.excecao && (l.ex === null || exIgual(l.ex, ex)))) return null;
  const inclusoes = vigentes.filter((l) => !l.excecao && exIgual(l.ex, ex));
  if (!inclusoes.length) return null;
  return inclusoes.sort((a, b) => b.ncm.length - a.ncm.length || Number(b.ex !== null) - Number(a.ex !== null))[0];
}
