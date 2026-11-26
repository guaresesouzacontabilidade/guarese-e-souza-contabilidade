import { Decimal } from "@/lib/dinheiro";

/**
 * Preço de venda e margem (sobre o custo): custo R$ 100 com margem de 30%
 * dá preço de R$ 130. A meta de margem vem do produto, senão do grupo,
 * senão da padrão da empresa. O custo de referência para o preço é o último
 * custo de compra (o que vai custar repor), senão o custo médio.
 */
type Valor = Decimal.Value | null | undefined;

function dec(v: Valor): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Decimal(v);
  return d.isFinite() ? d : null;
}

/** Margem real em % (uma casa) do preço sobre o custo; sem custo, null. */
export function margemReal(preco: Valor, custo: Valor): number | null {
  const p = dec(preco);
  const c = dec(custo);
  if (!p || !c || c.lte(0)) return null;
  return Number(p.div(c).minus(1).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString());
}

/** Preço com a margem sobre o custo, em centavos. */
export function precoSugerido(custo: Valor, margem: Valor): Decimal | null {
  const c = dec(custo);
  const m = dec(margem);
  if (!c || c.lte(0) || !m || m.lt(0)) return null;
  return c.times(m.div(100).plus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Lucro por unidade (preço − custo). */
export function lucroUnitario(preco: Valor, custo: Valor): Decimal | null {
  const p = dec(preco);
  const c = dec(custo);
  if (!p || !c || c.lte(0)) return null;
  return p.minus(c).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export type OrigemMargem = "produto" | "grupo" | "padrao";

/** Meta de margem do produto: a dele, a do grupo ou a padrão da empresa. */
export function margemAlvo(
  produto: { margem_desejada?: Valor; grupo?: string | null },
  grupos: Record<string, Valor>,
  padrao: Valor,
): { valor: number; origem: OrigemMargem } | null {
  const propria = dec(produto.margem_desejada);
  if (propria) return { valor: Number(propria.toString()), origem: "produto" };
  const doGrupo = produto.grupo ? dec(grupos[produto.grupo]) : null;
  if (doGrupo) return { valor: Number(doGrupo.toString()), origem: "grupo" };
  const p = dec(padrao);
  if (p) return { valor: Number(p.toString()), origem: "padrao" };
  return null;
}

/** Custo de referência: o da última compra, senão o cadastrado, senão o médio. */
export function custoReferencia(p: { ultimo_custo_entrada?: Valor; preco_custo?: Valor; custo_medio?: Valor }): Decimal | null {
  for (const v of [p.ultimo_custo_entrada, p.preco_custo, p.custo_medio]) {
    const d = dec(v);
    if (d && d.gt(0)) return d;
  }
  return null;
}

/**
 * O custo mudou depois da última mudança de preço? (entrada mais nova que o
 * preço e custo diferente, em mais de 0,5%, do custo da época do preço).
 */
export function custoMudouSemPreco(s: { ultima_entrada_em?: string | null; ultimo_custo_entrada?: Valor; preco_alterado_em?: string | null; custo_na_alteracao?: Valor }): boolean {
  if (!s.ultima_entrada_em || !s.preco_alterado_em) return false;
  if (new Date(s.ultima_entrada_em).getTime() <= new Date(s.preco_alterado_em).getTime()) return false;
  const novo = dec(s.ultimo_custo_entrada);
  const antigo = dec(s.custo_na_alteracao);
  if (!novo || novo.lte(0)) return false;
  if (!antigo || antigo.lte(0)) return true;
  return novo.minus(antigo).abs().div(antigo).gt(0.005);
}

/**
 * Quantos m³ tem 1 unidade de venda (madeira): M3 = 1; peça com espessura,
 * largura e comprimento; metro linear com espessura e largura. Senão, null.
 */
export function m3PorUnidade(p: { unidade: string; espessura_cm?: Valor; largura_cm?: Valor; comprimento_m?: Valor }): Decimal | null {
  const u = (p.unidade ?? "").toUpperCase();
  if (u === "M3") return new Decimal(1);
  const esp = dec(p.espessura_cm);
  const larg = dec(p.largura_cm);
  if (!esp || !larg || esp.lte(0) || larg.lte(0)) return null;
  const secao = esp.div(100).times(larg.div(100));
  if (u === "M" || u === "ML") return secao;
  const comp = dec(p.comprimento_m);
  if ((u === "PC" || u === "UN" || u === "DZ") && comp && comp.gt(0)) return secao.times(comp).times(u === "DZ" ? 12 : 1);
  return null;
}

/** Preço equivalente por m³ (para comparar peças de medidas diferentes). */
export function precoPorM3(preco: Valor, m3: Decimal | null): Decimal | null {
  const p = dec(preco);
  if (!p || !m3 || m3.lte(0)) return null;
  return p.div(m3).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
