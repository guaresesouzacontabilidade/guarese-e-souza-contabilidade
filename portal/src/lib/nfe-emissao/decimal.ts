/**
 * Números decimais exatos para os valores da NF-e (sem os erros de ponto
 * flutuante, como 2,675 × 100). Cada valor é um inteiro (bigint) em
 * décimos de bilionésimo: 1 = 0,0000000001. Arredondamento "meio para cima"
 * (0,005 → 0,01), o usual nos documentos fiscais.
 */

export type Dec = bigint;

const ESCALA = 10;
const UM = 10n ** BigInt(ESCALA);

export const ZERO: Dec = 0n;

/** "1.234,56" não: aceita "1234.56", "1234,56", 1234.56. */
export function dec(v: string | number | null | undefined): Dec {
  if (v == null || v === "") return 0n;
  const s = typeof v === "number" ? numeroParaTexto(v) : v.trim().replace(",", ".");
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Número inválido: ${v}`);
  const fracao = (m[3] ?? "").padEnd(ESCALA + 1, "0");
  let n = BigInt(m[2]) * UM + BigInt(fracao.slice(0, ESCALA));
  // casa além da escala: arredonda
  if (Number(fracao[ESCALA]) >= 5) n += 1n;
  return m[1] ? -n : n;
}

function numeroParaTexto(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Número inválido: ${n}`);
  // toFixed evita a notação científica (1e-7)
  return n.toFixed(ESCALA + 1);
}

function dividirArredondando(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Divisão por zero.");
  const negativo = a < 0n !== b < 0n;
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const q = (x * 2n + y) / (2n * y);
  return negativo ? -q : q;
}

export const somar = (...v: Dec[]): Dec => v.reduce((a, b) => a + b, 0n);
export const subtrair = (a: Dec, b: Dec): Dec => a - b;
export const multiplicar = (a: Dec, b: Dec): Dec => dividirArredondando(a * b, UM);
export const dividir = (a: Dec, b: Dec): Dec => dividirArredondando(a * UM, b);
/** Percentual: `base × p / 100`. */
export const percentual = (base: Dec, p: Dec): Dec => dividirArredondando(base * p, UM * 100n);

export function arredondar(a: Dec, casas: number): Dec {
  const passo = 10n ** BigInt(ESCALA - casas);
  return dividirArredondando(a, passo) * passo;
}

export function maior(a: Dec, b: Dec): Dec {
  return a > b ? a : b;
}

/** Texto com `casas` decimais e ponto (formato do XML): 1234.5 → "1234.50". */
export function fmt(a: Dec, casas: number): string {
  const r = arredondar(a, casas);
  const negativo = r < 0n;
  const abs = negativo ? -r : r;
  const inteiro = abs / UM;
  const resto = (abs % UM).toString().padStart(ESCALA, "0").slice(0, casas);
  return `${negativo ? "-" : ""}${inteiro}${casas ? `.${resto}` : ""}`;
}

/** Texto com até `max` decimais, sem zeros à direita (quantidades, valor unitário): 10.5000 → "10.5". */
export function fmtVariavel(a: Dec, max: number, min = 0): string {
  let s = fmt(a, max);
  if (!s.includes(".")) return s;
  s = s.replace(/0+$/, "");
  const [i, f = ""] = s.split(".");
  const fr = f.padEnd(min, "0");
  return fr ? `${i}.${fr}` : i;
}

export function paraNumero(a: Dec): number {
  return Number(fmt(a, ESCALA));
}

/**
 * Divide `total` entre as partes na proporção dos `pesos` (frete, seguro e
 * desconto da nota pelos itens), em centavos; a diferença do arredondamento
 * fica com a última parte, para que a soma bata exatamente com o total.
 */
export function ratear(total: Dec, pesos: Dec[]): Dec[] {
  const t = arredondar(total, 2);
  if (t === 0n || !pesos.length) return pesos.map(() => 0n);
  const soma = somar(...pesos);
  if (soma === 0n) return pesos.map((_, i) => (i === pesos.length - 1 ? t : 0n));
  let acumulado = 0n;
  return pesos.map((p, i) => {
    if (i === pesos.length - 1) return t - acumulado;
    const parte = arredondar(dividirArredondando(t * p, soma), 2);
    acumulado += parte;
    return parte;
  });
}
