import { Decimal } from "@/lib/dinheiro";
import { m3PorUnidade } from "./precos";
import { temConversao } from "./conversao";

/**
 * Contas da reposição e análise do estoque (sem acesso ao banco, para testar):
 * média de venda por dia, quantos dias o estoque dura, sugestão de compra,
 * produtos parados com o dinheiro empatado, curva ABC e estoque por grupo.
 */
export interface ProdutoAnalise {
  id: string;
  descricao: string;
  codigo: string;
  grupo: string | null;
  unidade: string;
  estoque_atual: string;
  estoque_minimo: string | null;
  custo_medio: string | null;
  preco_custo: string | null;
  valor_unitario: string | null;
  controla_estoque: boolean;
  espessura_cm: string | null;
  largura_cm: string | null;
  comprimento_m: string | null;
  /** Compra em outra unidade (ex.: PC) e quanto cada uma rende na unidade de venda. */
  unidade_compra?: string | null;
  fator_compra?: string | null;
}

export interface VendaProduto {
  produto_id: string;
  /** Quantidade vendida no período. */
  quantidade: string;
  faturamento: string;
  /** Custo do que foi vendido no período (quantidade × custo na hora da venda). */
  custo: string;
  vendas: number;
  /** Última venda (qualquer data), AAAA-MM-DD. */
  ultima_venda: string | null;
}

/** Unidades vendidas em fração (medida, peso ou volume); as outras são contadas inteiras. */
const FRACIONADAS = new Set(["M3", "M", "ML", "M2", "KG", "L", "G", "T", "TON"]);

const d = (v: Decimal.Value | null | undefined) => {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  const x = new Decimal(v);
  return x.isFinite() ? x : new Decimal(0);
};

export function custoUnitario(p: Pick<ProdutoAnalise, "custo_medio" | "preco_custo">): Decimal {
  const medio = d(p.custo_medio);
  return medio.gt(0) ? medio : d(p.preco_custo);
}

/** Média vendida por dia no período. */
export function mediaDiaria(quantidade: Decimal.Value, dias: number): Decimal {
  if (dias <= 0) return new Decimal(0);
  return d(quantidade).div(dias);
}

/** Quantos dias o estoque dura no ritmo de venda (null: não vendeu no período). */
export function diasDeCobertura(estoque: Decimal.Value, media: Decimal): number | null {
  const e = d(estoque);
  if (e.lte(0)) return 0;
  if (media.lte(0)) return null;
  return Math.floor(e.div(media).toNumber());
}

/** Arredonda a compra para cima: inteiro (peças, unidades) ou 3 casas (m³, metro, kg). */
export function arredondarCompra(q: Decimal, unidade: string): Decimal {
  if (q.lte(0)) return new Decimal(0);
  return FRACIONADAS.has(unidade.toUpperCase()) ? q.toDecimalPlaces(3, Decimal.ROUND_UP) : q.toDecimalPlaces(0, Decimal.ROUND_UP);
}

export interface LinhaReposicao {
  produto: ProdutoAnalise;
  vendido: Decimal;
  media: Decimal;
  cobertura: number | null;
  /** Na unidade de venda (com conversão: as unidades de compra inteiras × rendimento). */
  comprar: Decimal;
  /** Na unidade de compra, quando o produto compra numa unidade e vende em outra (ex.: 5 peças). */
  comprarNaCompra: Decimal | null;
  valorCompra: Decimal;
  motivo: "zerado" | "minimo" | "ritmo";
}

/**
 * Sugestão de compra: ter estoque para `diasAlvo` dias no ritmo de venda do
 * período, e nunca menos que o mínimo. Compra = meta − estoque (arredondada).
 */
export function sugestaoCompra(produtos: ProdutoAnalise[], vendas: Map<string, VendaProduto>, diasPeriodo: number, diasAlvo: number): LinhaReposicao[] {
  const linhas: LinhaReposicao[] = [];
  for (const p of produtos) {
    if (!p.controla_estoque) continue;
    const vendido = d(vendas.get(p.id)?.quantidade);
    const media = mediaDiaria(vendido, diasPeriodo);
    const estoque = d(p.estoque_atual);
    const minimo = d(p.estoque_minimo);
    const meta = Decimal.max(minimo, media.times(diasAlvo));
    const falta = meta.minus(estoque);
    // Compra em peça (ou caixa): compra peças inteiras, que rendem a quantidade em metros (ou unidades)
    const naCompra = temConversao(p) && falta.gt(0) ? falta.div(p.fator_compra).toDecimalPlaces(0, Decimal.ROUND_UP) : null;
    const comprar = naCompra ? naCompra.times(p.fator_compra!).toDecimalPlaces(4) : arredondarCompra(falta, p.unidade);
    if (comprar.lte(0)) continue;
    linhas.push({
      produto: p,
      vendido,
      media,
      cobertura: diasDeCobertura(estoque, media),
      comprar,
      comprarNaCompra: naCompra,
      valorCompra: comprar.times(custoUnitario(p)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
      motivo: estoque.lte(0) ? "zerado" : minimo.gt(0) && estoque.lt(minimo) ? "minimo" : "ritmo",
    });
  }
  // Primeiro o que acaba antes
  return linhas.sort((a, b) => (a.cobertura ?? Infinity) - (b.cobertura ?? Infinity) || b.valorCompra.cmp(a.valorCompra));
}

/** Dias inteiros entre duas datas AAAA-MM-DD. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
}

export interface LinhaParado {
  produto: ProdutoAnalise;
  estoque: Decimal;
  valorParado: Decimal;
  /** Dias desde a última venda (null: nunca vendeu). */
  diasSemVender: number | null;
  ultimaVenda: string | null;
}

/**
 * Produtos com estoque que não vendem há `limite` dias ou mais (ou nunca
 * venderam e a última entrada também tem `limite` dias ou mais), com o
 * dinheiro empatado (estoque × custo).
 */
export function produtosParados(
  produtos: ProdutoAnalise[],
  vendas: Map<string, VendaProduto>,
  ultimaEntrada: Map<string, string | null>,
  hoje: string,
  limite: number,
): LinhaParado[] {
  const linhas: LinhaParado[] = [];
  for (const p of produtos) {
    const estoque = d(p.estoque_atual);
    if (!p.controla_estoque || estoque.lte(0)) continue;
    const ultimaVenda = vendas.get(p.id)?.ultima_venda ?? null;
    let diasSemVender: number | null = null;
    if (ultimaVenda) {
      diasSemVender = diasEntre(ultimaVenda, hoje);
      if (diasSemVender < limite) continue;
    } else {
      const entrada = ultimaEntrada.get(p.id);
      if (entrada && diasEntre(entrada.slice(0, 10), hoje) < limite) continue;
    }
    linhas.push({ produto: p, estoque, valorParado: estoque.times(custoUnitario(p)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP), diasSemVender, ultimaVenda });
  }
  return linhas.sort((a, b) => b.valorParado.cmp(a.valorParado));
}

export interface LinhaAbc {
  produto: ProdutoAnalise;
  quantidade: Decimal;
  faturamento: Decimal;
  lucro: Decimal;
  participacao: number;
  acumulado: number;
  classe: "A" | "B" | "C";
}

/**
 * Curva ABC pelo faturamento do período: A = os que somam os primeiros 80%,
 * B = até 95%, C = o resto. Só produtos que venderam no período.
 */
export function curvaAbc(produtos: ProdutoAnalise[], vendas: Map<string, VendaProduto>): LinhaAbc[] {
  const base = produtos
    .map((p) => ({ p, v: vendas.get(p.id) }))
    .filter((x) => x.v && d(x.v.faturamento).gt(0))
    .map(({ p, v }) => ({ produto: p, quantidade: d(v!.quantidade), faturamento: d(v!.faturamento), lucro: d(v!.faturamento).minus(d(v!.custo)) }))
    .sort((a, b) => b.faturamento.cmp(a.faturamento));
  const total = base.reduce((s, x) => s.plus(x.faturamento), new Decimal(0));
  if (total.lte(0)) return [];
  let acumulado = new Decimal(0);
  return base.map((x) => {
    const antes = acumulado.div(total).times(100);
    acumulado = acumulado.plus(x.faturamento);
    const pctAcumulado = acumulado.div(total).times(100);
    // A classe vem de onde o produto começa na curva (o que cruza 80% ainda é A)
    const classe = antes.lt(80) ? "A" : antes.lt(95) ? "B" : "C";
    return {
      ...x,
      participacao: Number(x.faturamento.div(total).times(100).toDecimalPlaces(1).toString()),
      acumulado: Number(pctAcumulado.toDecimalPlaces(1).toString()),
      classe,
    };
  });
}

export interface LinhaGrupo {
  grupo: string;
  produtos: number;
  /** Quantidade por unidade (ex.: { PC: 120, M3: 3.5 }). */
  quantidades: Record<string, Decimal>;
  m3: Decimal;
  valor: Decimal;
  semEstoque: number;
}

/** Estoque por grupo: quantidade por unidade, m³ (madeira) e valor pelo custo. */
export function estoquePorGrupo(produtos: ProdutoAnalise[]): LinhaGrupo[] {
  const mapa = new Map<string, LinhaGrupo>();
  for (const p of produtos) {
    if (!p.controla_estoque) continue;
    const nome = p.grupo?.trim() || "Sem grupo";
    const g = mapa.get(nome) ?? { grupo: nome, produtos: 0, quantidades: {}, m3: new Decimal(0), valor: new Decimal(0), semEstoque: 0 };
    const estoque = d(p.estoque_atual);
    g.produtos += 1;
    if (estoque.lte(0)) {
      g.semEstoque += 1;
    } else {
      const u = p.unidade.toUpperCase();
      g.quantidades[u] = (g.quantidades[u] ?? new Decimal(0)).plus(estoque);
      const m3 = m3PorUnidade(p);
      if (m3) g.m3 = g.m3.plus(estoque.times(m3));
      g.valor = g.valor.plus(estoque.times(custoUnitario(p)));
    }
    mapa.set(nome, g);
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, m3: g.m3.toDecimalPlaces(3, Decimal.ROUND_HALF_UP), valor: g.valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }))
    .sort((a, b) => b.valor.cmp(a.valor) || a.grupo.localeCompare(b.grupo, "pt-BR"));
}

/** Valor total do estoque pelo custo e m³ total (madeira). */
export function totaisEstoque(produtos: ProdutoAnalise[]) {
  return estoquePorGrupo(produtos).reduce((s, g) => ({ valor: s.valor.plus(g.valor), m3: s.m3.plus(g.m3) }), { valor: new Decimal(0), m3: new Decimal(0) });
}
