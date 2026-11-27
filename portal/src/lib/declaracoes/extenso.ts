import Decimal from "decimal.js";

/** Valor em reais por extenso, em português (ex.: "mil, duzentos e trinta reais e quarenta e cinco centavos"). */

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
const ESCALAS: [string, string][] = [
  ["", ""],
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
  ["trilhão", "trilhões"],
];

/** 1 a 999 por extenso. */
function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto >= 10 && resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
  else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (d) partes.push(DEZENAS[d]);
    if (u) partes.push(UNIDADES[u]);
  }
  return partes.join(" e ");
}

/** Inteiro por extenso (sem a moeda); 0 vira "zero". */
export function inteiroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("Use um número inteiro de zero para cima.");
  if (n === 0) return "zero";
  const grupos: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  if (grupos.length > ESCALAS.length) throw new Error("Número grande demais.");
  const partes: { texto: string; valor: number }[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    const [singular, plural] = ESCALAS[i];
    const texto = i === 1 && g === 1 ? "mil" : `${ate999(g)}${singular ? ` ${g === 1 ? singular : plural}` : ""}`;
    partes.push({ texto, valor: g });
  }
  // O último grupo entra com "e" quando é menor que cem ou uma centena exata ("mil e cem", "mil e quinze")
  return partes.reduce((frase, p, i) => {
    if (i === 0) return p.texto;
    const ultimo = i === partes.length - 1;
    return `${frase}${ultimo && (p.valor < 100 || p.valor % 100 === 0) ? " e " : ", "}${p.texto}`;
  }, "");
}

export function valorPorExtenso(valor: Decimal.Value): string {
  const d = new Decimal(valor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (d.isNegative()) throw new Error("Use um valor de zero para cima.");
  const reais = d.floor().toNumber();
  const centavos = d.minus(d.floor()).times(100).round().toNumber();
  if (reais === 0 && centavos === 0) return "zero real";
  const partes: string[] = [];
  if (reais > 0) {
    const texto = inteiroPorExtenso(reais);
    // "um milhão de reais", "dois bilhões de reais"
    const deReais = /(milhão|milhões|bilhão|bilhões|trilhão|trilhões)$/.test(texto);
    partes.push(`${texto}${deReais ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.join(" e ");
}
