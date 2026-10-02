import Decimal from "decimal.js";

/**
 * Valores monetários: sempre em Decimal (nunca float) nas contas feitas na
 * aplicação. No banco, numeric(15,2).
 */
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });

export type ValorEntrada = Decimal | number | string | null | undefined;

export function dec(v: ValorEntrada): Decimal {
  if (v instanceof Decimal) return v;
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(typeof v === "number" ? v.toString() : v);
}

/** Arredonda para centavos (meio-para-cima, como em documentos fiscais). */
export function centavos(v: ValorEntrada): Decimal {
  return dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function somar(valores: ValorEntrada[]): Decimal {
  return valores.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

/**
 * Converte texto digitado no padrão brasileiro em Decimal.
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 1.234,56", "-10,00", "(10,00)".
 * Retorna null quando o texto não é um número válido.
 */
export function lerValorBR(texto: string | null | undefined): Decimal | null {
  if (texto === null || texto === undefined) return null;
  let t = String(texto).trim();
  if (!t) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/R\$|\s| /g, "");
  if (t.endsWith("-")) {
    negativo = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith("-")) {
    negativo = !negativo;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  // Sinais de crédito/débito usados por alguns bancos
  if (/[DdCc]$/.test(t)) {
    if (/[Dd]$/.test(t)) negativo = !negativo;
    t = t.slice(0, -1);
  }
  const temVirgula = t.includes(",");
  const temPonto = t.includes(".");
  if (temVirgula && temPonto) {
    // O último separador é o decimal
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (temVirgula) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (temPonto) {
    // "1.234" (milhar) x "12.34" (decimal): mais de um ponto ou grupo de 3 dígitos = milhar
    const partes = t.split(".");
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3 && !/^0/.test(partes[0]))) {
      t = partes.join("");
    }
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const d = new Decimal(t);
  return negativo ? d.negated() : d;
}

/** Divide um valor em N parcelas exatas em centavos (diferença na última). */
export function dividirParcelas(total: ValorEntrada, n: number): Decimal[] {
  const t = centavos(total);
  const base = t.dividedBy(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const parcelas = Array.from({ length: n }, () => base);
  parcelas[n - 1] = t.minus(base.times(n - 1));
  return parcelas;
}

/** Formata em reais sem passar por ponto flutuante. */
export function formatarMoeda(v: ValorEntrada, opcoes?: { sinal?: boolean; semSimbolo?: boolean }): string {
  if (v === null || v === undefined || v === "") return "—";
  const d = centavos(v);
  const negativo = d.isNegative() && !d.isZero();
  const [inteiro, decimal] = d.abs().toFixed(2).split(".");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const corpo = `${opcoes?.semSimbolo ? "" : "R$ "}${comMilhar},${decimal}`;
  if (negativo) return `−${corpo}`;
  if (opcoes?.sinal && !d.isZero()) return `+${corpo}`;
  return corpo;
}

export { Decimal };
