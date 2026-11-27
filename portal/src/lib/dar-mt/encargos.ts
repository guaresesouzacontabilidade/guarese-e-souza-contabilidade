import Decimal from "decimal.js";
import { centavos, dec, type ValorEntrada } from "@/lib/dinheiro";

/**
 * Acréscimos do ICMS pago em atraso em Mato Grosso (desde 01/03/2024):
 *
 *  - multa de mora: 0,333% por dia de atraso, limitada a 20%, sobre o
 *    principal — a mesma conta do formulário do DAR-1/AUT da SEFAZ-MT (acima
 *    de 60 dias, 20%);
 *  - juros de mora: SELIC acumulada mensalmente do mês seguinte ao vencimento
 *    até o mês anterior ao pagamento, mais 1% no mês do pagamento, sobre o
 *    principal (pago no próprio mês do vencimento: sem juros).
 *
 * Sem correção monetária à parte. As datas são "AAAA-MM-DD".
 */

const MS_DIA = 86_400_000;
const LIMITE_MULTA = new Decimal(20);
const MULTA_DIA = new Decimal("0.333");

export interface EncargosDar {
  principal: Decimal;
  diasAtraso: number;
  multaPercentual: Decimal;
  multa: Decimal;
  /** Meses de SELIC somados (AAAA-MM), sem o 1% do mês do pagamento. */
  mesesSelic: string[];
  jurosPercentual: Decimal;
  juros: Decimal;
  total: Decimal;
}

function diaUtc(data: string): number {
  const [a, m, d] = data.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** Meses AAAA-MM estritamente entre o do vencimento e o do pagamento. */
export function mesesEntre(vencimento: string, pagamento: string): string[] {
  const meses: string[] = [];
  let [a, m] = vencimento.slice(0, 7).split("-").map(Number);
  const fim = pagamento.slice(0, 7);
  for (;;) {
    m += 1;
    if (m > 12) [a, m] = [a + 1, 1];
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    if (mes >= fim) return meses;
    meses.push(mes);
  }
}

/**
 * Calcula multa e juros para pagar até a data informada. `selic` traz a taxa
 * acumulada de cada mês (em %, AAAA-MM → valor); falta de um mês necessário é
 * erro, para nunca gerar guia com juros a menos.
 */
export function calcularEncargos(entrada: { principal: ValorEntrada; vencimento: string; pagamento: string; selic: Record<string, ValorEntrada> }): EncargosDar {
  const principal = centavos(dec(entrada.principal));
  const dias = Math.max(0, Math.round((diaUtc(entrada.pagamento) - diaUtc(entrada.vencimento)) / MS_DIA));
  const multaPercentual = dias > 60 ? LIMITE_MULTA : Decimal.min(LIMITE_MULTA, MULTA_DIA.times(dias));
  const multa = centavos(principal.times(multaPercentual).div(100));

  let mesesSelic: string[] = [];
  let jurosPercentual = new Decimal(0);
  if (dias > 0 && entrada.pagamento.slice(0, 7) > entrada.vencimento.slice(0, 7)) {
    mesesSelic = mesesEntre(entrada.vencimento, entrada.pagamento);
    for (const mes of mesesSelic) {
      const taxa = entrada.selic[mes];
      if (taxa == null) throw new Error(`Taxa SELIC de ${mes.slice(5, 7)}/${mes.slice(0, 4)} não encontrada.`);
      jurosPercentual = jurosPercentual.plus(dec(taxa));
    }
    jurosPercentual = jurosPercentual.plus(1);
  }
  const juros = centavos(principal.times(jurosPercentual).div(100));
  return { principal, diasAtraso: dias, multaPercentual, multa, mesesSelic, jurosPercentual, juros, total: principal.plus(multa).plus(juros) };
}
