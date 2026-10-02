/**
 * Cálculos dos relatórios gerenciais de uma empresa (funções puras).
 * Valores monetários sempre em Decimal; as consultas ficam em ./dados.ts.
 */
import { Decimal, dec, somar, type ValorEntrada } from "@/lib/dinheiro";
import { competenciaDe, diasEntre, lerCompetencia, somarMeses } from "@/lib/competencia";

const ZERO = new Decimal(0);

// -----------------------------------------------------------------------------
// Período
// -----------------------------------------------------------------------------

export const MAXIMO_MESES = 24;

/** Competências ("AAAA-MM-01") de `inicio` até `fim`, inclusive. */
export function mesesEntre(inicio: string, fim: string): string[] {
  const meses: string[] = [];
  let m = competenciaDe(inicio);
  const ultimo = competenciaDe(fim);
  while (m <= ultimo && meses.length < 120) {
    meses.push(m);
    m = somarMeses(m, 1);
  }
  return meses;
}

/**
 * Período em meses a partir dos parâmetros `de` e `ate` ("AAAA-MM").
 * Padrão: últimos `padrao` meses até o mês atual; no máximo 24 meses.
 */
export function periodoMensal(de: string | undefined, ate: string | undefined, atual: string, padrao = 6): { inicio: string; fim: string } {
  let fim = lerCompetencia(ate) ?? atual;
  let inicio = lerCompetencia(de) ?? somarMeses(fim, -(padrao - 1));
  if (inicio > fim) [inicio, fim] = [fim, inicio];
  if (mesesEntre(inicio, fim).length > MAXIMO_MESES) inicio = somarMeses(fim, -(MAXIMO_MESES - 1));
  return { inicio, fim };
}

// -----------------------------------------------------------------------------
// Fluxo de caixa mensal (realizado x previsto)
// -----------------------------------------------------------------------------

export interface LinhaFluxoRealizado {
  data: string;
  registro: string;
  grupo: string;
  conta_disponivel: boolean | null;
  conta_contrapartida_disponivel: boolean | null;
  entrada: ValorEntrada;
  saida: ValorEntrada;
}

export interface LancamentoPrevisto {
  tipo: string;
  data_vencimento: string;
  valor_previsto: ValorEntrada;
}

export interface MesFluxo {
  mes: string;
  entradasPrevistas: Decimal;
  saidasPrevistas: Decimal;
  entradasRealizadas: Decimal;
  saidasRealizadas: Decimal;
}

export const GRUPOS_FLUXO: Record<string, string> = {
  operacional: "Operacional",
  investimento: "Investimentos",
  financiamento: "Sócios e empréstimos",
  transferencia: "Cartões e outras contas",
};

/**
 * Considera somente o caixa disponível (bancos e caixa): movimentos em
 * cartões e maquininhas entram quando chegam às contas disponíveis, e
 * transferências entre duas contas disponíveis se anulam (são ignoradas).
 */
export function movimentoDeCaixa(l: LinhaFluxoRealizado): boolean {
  if (!l.conta_disponivel) return false;
  if (l.registro === "transferencia" && l.conta_contrapartida_disponivel) return false;
  return true;
}

export function montarFluxoMensal(meses: string[], realizados: LinhaFluxoRealizado[], previstos: LancamentoPrevisto[]) {
  const porMes = new Map<string, MesFluxo>(
    meses.map((mes) => [mes, { mes, entradasPrevistas: ZERO, saidasPrevistas: ZERO, entradasRealizadas: ZERO, saidasRealizadas: ZERO }]),
  );
  const porGrupo = new Map<string, { entradas: Decimal; saidas: Decimal }>();
  for (const l of realizados) {
    if (!movimentoDeCaixa(l)) continue;
    const m = porMes.get(competenciaDe(l.data));
    if (!m) continue;
    m.entradasRealizadas = m.entradasRealizadas.plus(dec(l.entrada));
    m.saidasRealizadas = m.saidasRealizadas.plus(dec(l.saida));
    const g = porGrupo.get(l.grupo) ?? { entradas: ZERO, saidas: ZERO };
    porGrupo.set(l.grupo, { entradas: g.entradas.plus(dec(l.entrada)), saidas: g.saidas.plus(dec(l.saida)) });
  }
  for (const p of previstos) {
    const m = porMes.get(competenciaDe(p.data_vencimento));
    if (!m) continue;
    if (p.tipo === "receber") m.entradasPrevistas = m.entradasPrevistas.plus(dec(p.valor_previsto));
    else m.saidasPrevistas = m.saidasPrevistas.plus(dec(p.valor_previsto));
  }
  const lista = [...porMes.values()];
  const totais = {
    entradasPrevistas: somar(lista.map((m) => m.entradasPrevistas)),
    saidasPrevistas: somar(lista.map((m) => m.saidasPrevistas)),
    entradasRealizadas: somar(lista.map((m) => m.entradasRealizadas)),
    saidasRealizadas: somar(lista.map((m) => m.saidasRealizadas)),
  };
  const grupos = Object.keys(GRUPOS_FLUXO)
    .filter((g) => porGrupo.has(g))
    .map((g) => ({ grupo: g, rotulo: GRUPOS_FLUXO[g], ...porGrupo.get(g)! }));
  return { meses: lista, totais, grupos };
}

export type FluxoMensal = ReturnType<typeof montarFluxoMensal>;

// -----------------------------------------------------------------------------
// DRE gerencial (por competência)
// -----------------------------------------------------------------------------

export interface LinhaDreBanco {
  mes: string;
  categoria_id: string;
  categoria_codigo: string;
  categoria_nome: string;
  tipo: string;
  valor: ValorEntrada;
}

/** Estrutura da DRE: grupos (somam ou subtraem) e subtotais acumulados. */
export const ESTRUTURA_DRE: ({ chave: string; rotulo: string; tipos: string[]; sinal: 1 | -1 } | { chave: string; rotulo: string; subtotal: true })[] = [
  { chave: "receita_bruta", rotulo: "Receita bruta", tipos: ["receita_operacional"], sinal: 1 },
  { chave: "deducoes", rotulo: "(−) Deduções da receita", tipos: ["deducao_receita"], sinal: -1 },
  { chave: "receita_liquida", rotulo: "Receita líquida", subtotal: true },
  { chave: "custos", rotulo: "(−) Custos", tipos: ["custo_mercadoria", "custo_servico"], sinal: -1 },
  { chave: "lucro_bruto", rotulo: "Lucro bruto", subtotal: true },
  { chave: "despesas", rotulo: "(−) Despesas operacionais", tipos: ["despesa_operacional"], sinal: -1 },
  { chave: "resultado_operacional", rotulo: "Resultado operacional", subtotal: true },
  { chave: "receitas_financeiras", rotulo: "(+) Receitas financeiras", tipos: ["receita_financeira"], sinal: 1 },
  { chave: "despesas_financeiras", rotulo: "(−) Despesas financeiras", tipos: ["despesa_financeira"], sinal: -1 },
  { chave: "outras_receitas", rotulo: "(+) Outras receitas", tipos: ["outras_receitas"], sinal: 1 },
  { chave: "outras_despesas", rotulo: "(−) Outras despesas", tipos: ["outras_despesas"], sinal: -1 },
  { chave: "resultado_antes_impostos", rotulo: "Resultado antes dos impostos sobre o lucro", subtotal: true },
  { chave: "impostos_lucro", rotulo: "(−) IRPJ e CSLL", tipos: ["impostos_lucro"], sinal: -1 },
  { chave: "resultado_liquido", rotulo: "Resultado líquido", subtotal: true },
];

export interface LinhaDre {
  nivel: "grupo" | "categoria" | "subtotal";
  chave: string;
  rotulo: string;
  /** Grupos e categorias: valores positivos (o rótulo indica o sinal). Subtotais: com sinal. */
  valores: Decimal[];
  total: Decimal;
}

export function montarDre(meses: string[], linhas: LinhaDreBanco[]) {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const zeros = () => meses.map(() => ZERO);
  // categoria -> valores por mês
  const categorias = new Map<string, { codigo: string; nome: string; tipo: string; valores: Decimal[] }>();
  for (const l of linhas) {
    const i = idx.get(competenciaDe(l.mes));
    if (i === undefined) continue;
    const c = categorias.get(l.categoria_id) ?? { codigo: l.categoria_codigo, nome: l.categoria_nome, tipo: l.tipo, valores: zeros() };
    c.valores[i] = c.valores[i].plus(dec(l.valor));
    categorias.set(l.categoria_id, c);
  }
  const saida: LinhaDre[] = [];
  let acumulado = zeros();
  for (const item of ESTRUTURA_DRE) {
    if ("subtotal" in item) {
      saida.push({ nivel: "subtotal", chave: item.chave, rotulo: item.rotulo, valores: acumulado, total: somar(acumulado) });
      continue;
    }
    const cats = [...categorias.entries()]
      .filter(([, c]) => item.tipos.includes(c.tipo))
      .sort(([, a], [, b]) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
    const valores = meses.map((_, i) => somar(cats.map(([, c]) => c.valores[i])));
    acumulado = acumulado.map((v, i) => (item.sinal > 0 ? v.plus(valores[i]) : v.minus(valores[i])));
    saida.push({ nivel: "grupo", chave: item.chave, rotulo: item.rotulo, valores, total: somar(valores) });
    for (const [id, c] of cats) {
      saida.push({ nivel: "categoria", chave: id, rotulo: `${c.codigo} ${c.nome}`, valores: c.valores, total: somar(c.valores) });
    }
  }
  const linha = (chave: string) => saida.find((l) => l.chave === chave)!;
  return {
    linhas: saida,
    receitaBruta: linha("receita_bruta"),
    receitaLiquida: linha("receita_liquida"),
    resultadoLiquido: linha("resultado_liquido"),
  };
}

export type Dre = ReturnType<typeof montarDre>;

/** Percentual de `parte` sobre `base` (null quando a base é zero). */
export function percentual(parte: Decimal, base: Decimal): number | null {
  if (base.isZero()) return null;
  return parte.dividedBy(base).times(100).toDecimalPlaces(1).toNumber();
}

// -----------------------------------------------------------------------------
// Contas a pagar e a receber por vencimento (aging)
// -----------------------------------------------------------------------------

export const FAIXAS_AGING = [
  { chave: "vencer_mais_30", rotulo: "A vencer em mais de 30 dias", vencido: false },
  { chave: "vencer_30", rotulo: "A vencer em até 30 dias", vencido: false },
  { chave: "vencido_30", rotulo: "Vencido há até 30 dias", vencido: true },
  { chave: "vencido_60", rotulo: "Vencido de 31 a 60 dias", vencido: true },
  { chave: "vencido_90", rotulo: "Vencido de 61 a 90 dias", vencido: true },
  { chave: "vencido_mais_90", rotulo: "Vencido há mais de 90 dias", vencido: true },
] as const;

export type FaixaAging = (typeof FAIXAS_AGING)[number]["chave"];

export function faixaAging(vencimento: string, hoje: string): FaixaAging {
  const dias = diasEntre(vencimento, hoje); // > 0: vencido há N dias
  if (dias <= 0) return -dias > 30 ? "vencer_mais_30" : "vencer_30";
  if (dias <= 30) return "vencido_30";
  if (dias <= 60) return "vencido_60";
  if (dias <= 90) return "vencido_90";
  return "vencido_mais_90";
}

export interface LancamentoAberto {
  tipo: string;
  data_vencimento: string;
  valor_previsto: ValorEntrada;
  valor_baixado: ValorEntrada;
  contraparte: string | null;
}

export function montarAging(lancamentos: LancamentoAberto[], hoje: string, maioresQuantos = 8) {
  const lado = () => ({
    faixas: Object.fromEntries(FAIXAS_AGING.map((f) => [f.chave, { valor: ZERO, quantidade: 0 }])) as Record<FaixaAging, { valor: Decimal; quantidade: number }>,
    total: ZERO,
    vencido: ZERO,
    porContraparte: new Map<string, { valor: Decimal; vencido: Decimal; quantidade: number }>(),
  });
  const r = { receber: lado(), pagar: lado() };
  for (const l of lancamentos) {
    const s = l.tipo === "receber" ? r.receber : r.pagar;
    const aberto = dec(l.valor_previsto).minus(dec(l.valor_baixado));
    if (!aberto.isPositive() || aberto.isZero()) continue;
    const faixa = faixaAging(l.data_vencimento, hoje);
    const venc = FAIXAS_AGING.find((f) => f.chave === faixa)!.vencido;
    s.faixas[faixa].valor = s.faixas[faixa].valor.plus(aberto);
    s.faixas[faixa].quantidade++;
    s.total = s.total.plus(aberto);
    if (venc) s.vencido = s.vencido.plus(aberto);
    const nome = l.contraparte?.trim() || "Sem cliente/fornecedor";
    const c = s.porContraparte.get(nome) ?? { valor: ZERO, vencido: ZERO, quantidade: 0 };
    s.porContraparte.set(nome, { valor: c.valor.plus(aberto), vencido: venc ? c.vencido.plus(aberto) : c.vencido, quantidade: c.quantidade + 1 });
  }
  const maiores = (m: Map<string, { valor: Decimal; vencido: Decimal; quantidade: number }>) =>
    [...m.entries()]
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.valor.comparedTo(a.valor) || a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, maioresQuantos);
  return {
    receber: { faixas: r.receber.faixas, total: r.receber.total, vencido: r.receber.vencido, maiores: maiores(r.receber.porContraparte) },
    pagar: { faixas: r.pagar.faixas, total: r.pagar.total, vencido: r.pagar.vencido, maiores: maiores(r.pagar.porContraparte) },
  };
}

export type Aging = ReturnType<typeof montarAging>;

// -----------------------------------------------------------------------------
// Saldos
// -----------------------------------------------------------------------------

export interface SaldoContaLinha {
  conta_id: string;
  nome: string;
  tipo: string;
  compoe_saldo_disponivel: boolean;
  saldo_sistema: ValorEntrada;
  saldo_extrato: ValorEntrada;
  saldo_extrato_data: string | null;
  movimentos_pendentes: number;
  conciliado_ate: string | null;
}

/**
 * Soma do saldo das contas que compõem o disponível. `incompleto` indica
 * contas sem saldo na data (data anterior ao saldo inicial informado).
 */
export function saldoDisponivel(saldos: SaldoContaLinha[]): { valor: Decimal | null; incompleto: boolean } {
  const disp = saldos.filter((s) => s.compoe_saldo_disponivel);
  const comSaldo = disp.filter((s) => s.saldo_sistema !== null && s.saldo_sistema !== undefined);
  return { valor: comSaldo.length ? somar(comSaldo.map((s) => s.saldo_sistema)) : null, incompleto: comSaldo.length < disp.length };
}
