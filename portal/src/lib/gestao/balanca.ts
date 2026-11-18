import { Decimal } from "@/lib/dinheiro";

/**
 * Pesagem no caixa (restaurante por quilo, açougue, hortifrúti):
 *
 *  - Leitura da balança ligada ao computador (USB ou serial). O padrão do
 *    mercado é o protocolo Toledo (também usado por Filizola, Urano e Elgin
 *    no modo "Toledo"): o caixa envia ENQ (0x05) e a balança responde
 *    STX + peso + ETX — por exemplo STX "00452" ETX = 0,452 kg. Quando o
 *    prato ainda está balançando a balança responde "IIIII"; peso negativo,
 *    "NNNNN"; acima do limite, "SSSSS". Há balanças que enviam o peso sem
 *    parar, como texto ("PESO: 0,452 kg"): o modo contínuo lê o último
 *    número da linha.
 *  - Etiqueta impressa pela balança (código de barras EAN-13 que começa com
 *    2): código do produto + preço total ou peso.
 *  - Peso do prato ou da embalagem (tara) descontado do peso lido.
 */

export type EstadoLeitura = "estavel" | "instavel" | "negativo" | "sobrecarga" | "invalido";

export interface LeituraBalanca {
  estado: EstadoLeitura;
  /** Peso em kg (3 casas), só quando estável. */
  pesoKg: Decimal | null;
}

const STX = "\u0002";
const ETX = "\u0003";
export const ENQ = 0x05;

const textoDe = (dados: Uint8Array | string) => (typeof dados === "string" ? dados : new TextDecoder("latin1").decode(dados));

function pesoDoTexto(t: string): Decimal | null {
  const limpo = t.trim().replace(/\s+/g, "");
  if (/^[0-9]{4,7}$/.test(limpo)) return new Decimal(limpo).dividedBy(1000).toDecimalPlaces(3); // gramas, sem vírgula
  const m = /^(-?)([0-9]{1,4})[.,]([0-9]{1,3})$/.exec(limpo);
  if (!m) return null;
  const valor = new Decimal(`${m[2]}.${m[3]}`);
  return m[1] ? valor.negated() : valor.toDecimalPlaces(3);
}

/** Resposta do protocolo Toledo (STX peso ETX). Usa o último quadro completo recebido. */
export function lerQuadroToledo(dados: Uint8Array | string): LeituraBalanca {
  const t = textoDe(dados);
  const fim = t.lastIndexOf(ETX);
  const inicio = fim >= 0 ? t.lastIndexOf(STX, fim) : -1;
  if (inicio < 0 || fim < 0) return { estado: "invalido", pesoKg: null };
  const corpo = t.slice(inicio + 1, fim).trim();
  if (/^I+$/i.test(corpo)) return { estado: "instavel", pesoKg: null };
  if (/^N+$/i.test(corpo)) return { estado: "negativo", pesoKg: null };
  if (/^S+$/i.test(corpo)) return { estado: "sobrecarga", pesoKg: null };
  const peso = pesoDoTexto(corpo);
  if (!peso) return { estado: "invalido", pesoKg: null };
  if (peso.isNegative()) return { estado: "negativo", pesoKg: null };
  return { estado: "estavel", pesoKg: peso };
}

/** Balança que envia o peso sem parar, como texto: o último número da última linha completa. */
export function lerTextoContinuo(dados: Uint8Array | string): LeituraBalanca {
  const linhas = textoDe(dados)
    .split(/[\r\n\u0002\u0003]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = linhas[i];
    if (/inst|mov|osc/i.test(l)) return { estado: "instavel", pesoKg: null };
    const numeros = l.match(/-?[0-9]{1,4}[.,][0-9]{1,3}|[0-9]{4,7}/g);
    if (!numeros) continue;
    const peso = pesoDoTexto(numeros[numeros.length - 1]);
    if (!peso) continue;
    if (peso.isNegative()) return { estado: "negativo", pesoKg: null };
    return { estado: "estavel", pesoKg: peso };
  }
  return { estado: "invalido", pesoKg: null };
}

export const MENSAGEM_LEITURA: Record<Exclude<EstadoLeitura, "estavel">, string> = {
  instavel: "O peso ainda está mexendo. Espere o prato parar e leia de novo.",
  negativo: "A balança está com peso negativo. Zere a balança (sem nada em cima) e leia de novo.",
  sobrecarga: "Peso acima do limite da balança.",
  invalido: "A balança não respondeu um peso. Confira o cabo, a velocidade e o modo nas opções da balança.",
};

/** Peso cobrado: peso lido menos o prato/embalagem (nunca abaixo de zero). */
export function pesoLiquido(pesoLidoKg: Decimal.Value, taraKg: Decimal.Value | null | undefined): Decimal {
  const liquido = new Decimal(pesoLidoKg).minus(taraKg ? new Decimal(taraKg) : 0);
  return Decimal.max(liquido, 0).toDecimalPlaces(3);
}

// -----------------------------------------------------------------------------
// Etiqueta da balança (EAN-13 iniciado em 2)
// -----------------------------------------------------------------------------

export type FormatoEtiqueta = "preco" | "peso";

export interface ConfigEtiqueta {
  formato: FormatoEtiqueta;
  /** Quantos dígitos do código do produto vêm logo depois do 2 (4, 5 ou 6). */
  digitosCodigo: 4 | 5 | 6;
}

export interface Etiqueta {
  /** Código do produto na balança (sem zeros à esquerda). */
  codigoProduto: string;
  /** Preço total impresso (formato "preco"). */
  valor: Decimal | null;
  /** Peso impresso em kg (formato "peso"). */
  pesoKg: Decimal | null;
}

export function digitoEan13Valido(codigo: string): boolean {
  if (!/^[0-9]{13}$/.test(codigo)) return false;
  const soma = [...codigo.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === Number(codigo[12]);
}

/**
 * "2" + código (4 a 6 dígitos) + valor (o que sobra até o 12º dígito) +
 * dígito verificador. No formato de preço, o valor vem em centavos; no de
 * peso, em gramas. Ex.: 2 0012 0 02345 D = produto 12, R$ 23,45.
 */
export function lerEtiquetaBalanca(codigo: string, cfg: ConfigEtiqueta): Etiqueta | null {
  const c = codigo.trim();
  if (!/^2[0-9]{12}$/.test(c) || !digitoEan13Valido(c)) return null;
  const codigoProduto = c.slice(1, 1 + cfg.digitosCodigo).replace(/^0+(?=.)/, "");
  const numero = new Decimal(c.slice(1 + cfg.digitosCodigo, 12));
  if (numero.lte(0)) return null;
  return cfg.formato === "preco"
    ? { codigoProduto, valor: numero.dividedBy(100), pesoKg: null }
    : { codigoProduto, valor: null, pesoKg: numero.dividedBy(1000) };
}

/** Mesmo código de produto, ignorando zeros à esquerda. */
export const mesmoCodigo = (a: string, b: string) => a.trim().replace(/^0+(?=.)/, "") === b.trim().replace(/^0+(?=.)/, "");

/**
 * Etiqueta com preço total: o peso (3 casas, arredondado para cima) e o
 * desconto de centavos que faz o total bater exatamente com o impresso.
 */
export function pesoPeloValor(valor: Decimal.Value, precoKg: Decimal.Value): { pesoKg: Decimal; desconto: Decimal } | null {
  const preco = new Decimal(precoKg);
  const v = new Decimal(valor);
  if (preco.lte(0) || v.lte(0)) return null;
  const peso = v.dividedBy(preco).toDecimalPlaces(3, Decimal.ROUND_UP);
  const total = peso.times(preco).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { pesoKg: peso, desconto: Decimal.max(total.minus(v), 0) };
}
