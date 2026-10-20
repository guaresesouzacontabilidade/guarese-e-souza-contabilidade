/**
 * Código de barras CODE-128C da chave de acesso no DANFE (Manual de
 * Orientação do Contribuinte, Anexo II): 44 dígitos em 22 pares, com o
 * dígito de controle módulo 103. Devolve as faixas como "1" (barra) e "0"
 * (espaço), uma por módulo, para desenhar no PDF.
 */

// Larguras (barra, espaço, barra, espaço, barra, espaço) dos símbolos 0 a 106 do CODE-128
const PADROES = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const INICIO_C = 105;
const PARADA = 106;

function modulos(padrao: string): string {
  let s = "";
  for (let i = 0; i < padrao.length; i++) s += (i % 2 === 0 ? "1" : "0").repeat(Number(padrao[i]));
  return s;
}

export function code128C(digitos: string): string {
  if (!/^(\d\d)+$/.test(digitos)) throw new Error("O CODE-128C codifica uma quantidade par de dígitos.");
  const valores = [INICIO_C];
  for (let i = 0; i < digitos.length; i += 2) valores.push(Number(digitos.slice(i, i + 2)));
  const soma = valores.reduce((a, v, i) => a + v * (i === 0 ? 1 : i), 0);
  valores.push(soma % 103, PARADA);
  return valores.map((v) => modulos(PADROES[v])).join("");
}

/** Retângulos das barras (em pontos) para o canvas do PDF. */
export function barrasDoCodigo(digitos: string, largura: number, altura: number): { x: number; w: number; h: number }[] {
  const m = code128C(digitos);
  const passo = largura / m.length;
  const barras: { x: number; w: number; h: number }[] = [];
  let i = 0;
  while (i < m.length) {
    if (m[i] === "1") {
      let j = i;
      while (j < m.length && m[j] === "1") j++;
      barras.push({ x: i * passo, w: (j - i) * passo, h: altura });
      i = j;
    } else i++;
  }
  return barras;
}
