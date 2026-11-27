import Decimal from "decimal.js";
import { somarMeses } from "@/lib/competencia";

/**
 * Faturamento sugerido para cada mês da declaração (o escritório confere e
 * pode mudar qualquer valor antes de emitir):
 *  - a receita informada nos Cálculos, quando existe (é o que o escritório usou);
 *  - senão, o das notas do portal: vendas + serviços − devoluções de vendas.
 */

export interface FaturamentoMes {
  competencia: string;
  vendas: number | string;
  servicos_nfe: number | string;
  servicos: number | string;
  devolucoes: number | string;
  notas_saida: number;
  informado: number | string | null;
}

export type OrigemValor = "notas" | "informado" | "digitado";

export interface MesDeclaracao {
  competencia: string; // AAAA-MM-01
  valor: string; // "1234.56"
  origem: OrigemValor;
  detalhe: string;
}

export const MAXIMO_MESES = 36;

/** Os 12 meses fechados antes do mês atual (ex.: em outubro/2026, de outubro/2025 a setembro/2026). */
export function ultimos12Meses(competenciaAtual: string): { inicio: string; fim: string } {
  const fim = somarMeses(competenciaAtual, -1);
  return { inicio: somarMeses(fim, -11), fim };
}

export function mesesDoPeriodo(inicio: string, fim: string): string[] {
  const meses: string[] = [];
  for (let m = inicio; m <= fim && meses.length <= MAXIMO_MESES; m = somarMeses(m, 1)) meses.push(m);
  return meses;
}

const brl = (v: Decimal) => v.toNumber().toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function sugerirValores(dados: FaturamentoMes[]): MesDeclaracao[] {
  return dados.map((d) => {
    const competencia = String(d.competencia).slice(0, 10);
    if (d.informado !== null && d.informado !== undefined) {
      return { competencia, valor: new Decimal(d.informado).toFixed(2), origem: "informado", detalhe: "receita informada nos Cálculos" };
    }
    const vendas = new Decimal(d.vendas || 0);
    const servicos = new Decimal(d.servicos_nfe || 0).plus(d.servicos || 0);
    const devolucoes = new Decimal(d.devolucoes || 0);
    const total = Decimal.max(vendas.plus(servicos).minus(devolucoes), 0);
    if (!d.notas_saida && total.isZero()) return { competencia, valor: "0.00", origem: "notas", detalhe: "sem notas de saída no portal" };
    const partes = [`vendas ${brl(vendas)}`];
    if (!servicos.isZero()) partes.push(`serviços ${brl(servicos)}`);
    if (!devolucoes.isZero()) partes.push(`devoluções −${brl(devolucoes)}`);
    return {
      competencia,
      valor: total.toFixed(2),
      origem: "notas",
      detalhe: `das notas (${d.notas_saida} ${d.notas_saida === 1 ? "nota" : "notas"}): ${partes.join(", ")}`,
    };
  });
}

/** Total e média mensal dos valores da declaração. */
export function totais(valores: (string | number)[]): { total: Decimal; media: Decimal } {
  const total = valores.reduce<Decimal>((t, v) => t.plus(v || 0), new Decimal(0));
  return { total, media: valores.length ? total.dividedBy(valores.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : new Decimal(0) };
}
