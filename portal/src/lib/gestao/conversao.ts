import { Decimal } from "@/lib/dinheiro";
import { formatarQuantidade, quantidadePorPecas, type MedidasProduto } from "./rotulos";

/**
 * Conversão de unidade entre compra e venda (ex.: compra em peça, vende em
 * metro: 1 peça rende 3 metros). As mesmas regras do banco
 * (app.unidade_classe e app.fator_da_nota).
 */

export interface ConversaoProduto {
  unidade: string;
  unidade_compra?: string | null;
  fator_compra?: string | number | null;
}

const CLASSES: Record<string, string[]> = {
  UN: ["UN", "UND", "UNID", "UNIDADE", "UNIDADES", "UNI", "U", "PC", "PCS", "PCA", "PECA", "PECAS"],
  M: ["M", "MT", "MTS", "ML", "MTL", "METRO", "METROS"],
  M2: ["M2", "MQ", "MTQ", "MT2"],
  M3: ["M3", "MT3", "MCU"],
  CX: ["CX", "CXA", "CXS", "CAIXA", "CAIXAS"],
  PCT: ["PCT", "PCTE", "PCTS", "PACOTE", "PACOTES"],
  KG: ["KG", "KGS", "QUILO", "QUILOS", "KILO", "KILOS"],
  L: ["L", "LT", "LTS", "LITRO", "LITROS"],
  DZ: ["DZ", "DUZ", "DUZIA", "DUZIAS"],
};
const CLASSE_DE = new Map(Object.entries(CLASSES).flatMap(([c, us]) => us.map((u) => [u, c] as const)));

/** A mesma unidade escrita de jeitos diferentes nas notas (PÇ, PEÇA, UND → UN; MTS → M). */
export function classeUnidade(u: string | null | undefined): string | null {
  const n = String(u ?? "")
    .trim()
    .toUpperCase()
    .replace(/Ç/g, "C")
    .replace(/[ÁÀÃÂ]/g, "A")
    .replace(/[ÉÊ]/g, "E")
    .replace(/Í/g, "I")
    .replace(/[ÓÔÕ]/g, "O")
    .replace(/Ú/g, "U")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[^A-Z0-9]/g, "");
  if (!n) return null;
  return CLASSE_DE.get(n) ?? n;
}

/** O produto compra numa unidade e vende em outra? */
export function temConversao(p: ConversaoProduto): p is ConversaoProduto & { unidade_compra: string; fator_compra: string | number } {
  return Boolean(p.unidade_compra && p.fator_compra != null && p.unidade_compra !== p.unidade && new Decimal(p.fator_compra).gt(0));
}

/**
 * Quantas unidades de venda vêm em 1 unidade da nota: o rendimento quando a
 * nota vem na unidade de compra; 1 na unidade de venda; null quando não dá
 * para saber (alguém confere).
 */
export function fatorDaNota(p: ConversaoProduto, unidadeNota: string | null | undefined): Decimal | null {
  if (!temConversao(p)) return new Decimal(1);
  const c = classeUnidade(unidadeNota);
  if (c && c === classeUnidade(p.unidade_compra)) return new Decimal(p.fator_compra);
  if (c && c === classeUnidade(p.unidade)) return new Decimal(1);
  return null;
}

const NOMES: Record<string, [string, string]> = {
  UN: ["Unidade", "Unidades"],
  PC: ["Peça", "Peças"],
  M: ["Metro", "Metros"],
  ML: ["Metro", "Metros"],
  M2: ["Metro quadrado", "Metros quadrados"],
  M3: ["Metro cúbico", "Metros cúbicos"],
  DZ: ["Dúzia", "Dúzias"],
  KG: ["Quilo", "Quilos"],
  CX: ["Caixa", "Caixas"],
  PCT: ["Pacote", "Pacotes"],
  L: ["Litro", "Litros"],
  MLT: ["Mililitro", "Mililitros"],
  G: ["Grama", "Gramas"],
  FR: ["Frasco", "Frascos"],
  AMP: ["Ampola", "Ampolas"],
  CP: ["Comprimido", "Comprimidos"],
  DOSE: ["Dose", "Doses"],
};

/** "Peça" / "Peças" (ou a sigla, para unidade fora da lista). */
export function nomeUnidade(u: string | null | undefined, quantidade: Decimal.Value = 1): string {
  const par = NOMES[String(u ?? "").toUpperCase()];
  if (!par) return String(u ?? "");
  return new Decimal(quantidade).abs().eq(1) ? par[0] : par[1];
}

/** Resumo da conversão para a tela: "1 Peça equivale a 3 Metros" e o exemplo com 10. */
export function resumoConversao(unidadeCompra: string, fator: Decimal.Value, unidadeVenda: string) {
  const f = new Decimal(fator);
  const dez = f.times(10);
  return {
    frase: `1 ${nomeUnidade(unidadeCompra, 1)} equivale a ${formatarQuantidade(f, 6)} ${nomeUnidade(unidadeVenda, f)}`,
    exemplo: `10 ${nomeUnidade(unidadeCompra, 10)} = ${formatarQuantidade(dez, 6)} ${nomeUnidade(unidadeVenda, dez)}`,
  };
}

/**
 * Rendimento sugerido pelas medidas da peça: compra por peça/unidade e vende
 * por metro (o comprimento) ou por m³ (o volume de uma peça).
 */
export function rendimentoSugerido(p: MedidasProduto, unidadeCompra: string): Decimal | null {
  if (classeUnidade(unidadeCompra) !== "UN") return null;
  if (p.unidade !== "M" && p.unidade !== "ML" && p.unidade !== "M3") return null;
  const q = quantidadePorPecas(p, 1, null);
  if (!q || q.lte(0)) return null;
  // m³ sem espessura e largura não dá para calcular por peça
  if (p.unidade === "M3" && (p.espessura_cm == null || p.largura_cm == null)) return null;
  return q;
}

/** Quantidade na unidade de compra para mostrar junto da de venda ("5 peças"), arredondada para cima. */
export function emUnidadesDeCompra(quantidadeVenda: Decimal.Value, p: ConversaoProduto): Decimal | null {
  if (!temConversao(p)) return null;
  return new Decimal(quantidadeVenda).div(p.fator_compra).toDecimalPlaces(0, Decimal.ROUND_UP);
}
