import Decimal from "decimal.js";

/** Rótulos e contas da gestão da loja (usados no navegador e no servidor). */

export type FormaPagamento = "dinheiro" | "pix" | "cartao_debito" | "cartao_credito" | "a_prazo" | "outro";

export const FORMAS_PAGAMENTO: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  a_prazo: "A prazo",
  outro: "Outro",
};

export const ORDEM_FORMAS: FormaPagamento[] = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "a_prazo", "outro"];

export const PERFIS_FISCAIS = {
  comercio: "Comércio (NFC-e no balcão e NF-e para empresas)",
  mei: "MEI (nota só nas vendas para empresas)",
  servicos: "Só serviços (nota de serviço)",
} as const;

export const UNIDADES_LOJA = [
  { valor: "UN", rotulo: "Unidade (UN)" },
  { valor: "PC", rotulo: "Peça (PC)" },
  { valor: "M3", rotulo: "Metro cúbico (M3)" },
  { valor: "M", rotulo: "Metro linear (M)" },
  { valor: "M2", rotulo: "Metro quadrado (M2)" },
  { valor: "DZ", rotulo: "Dúzia (DZ)" },
  { valor: "KG", rotulo: "Quilo (KG)" },
  { valor: "CX", rotulo: "Caixa (CX)" },
  { valor: "PCT", rotulo: "Pacote (PCT)" },
  { valor: "L", rotulo: "Litro (L)" },
] as const;

export const TIPOS_MOVIMENTO: Record<string, string> = {
  entrada_compra: "Entrada (nota de compra)",
  entrada_manual: "Entrada manual",
  saida_manual: "Saída manual",
  inventario: "Ajuste de inventário",
  venda: "Venda",
  cancelamento_venda: "Venda cancelada (devolução ao estoque)",
};

export interface MedidasProduto {
  unidade: string;
  espessura_cm: number | string | null;
  largura_cm: number | string | null;
  comprimento_m?: number | string | null;
}

/** Como a quantidade é informada: cubagem (m³), metro linear ou direto. */
export function modoMedida(p: MedidasProduto): "cubagem" | "metro" | "direto" {
  if (p.unidade === "M3" && p.espessura_cm != null && p.largura_cm != null) return "cubagem";
  if (p.unidade === "M" || p.unidade === "ML") return "metro";
  return "direto";
}

/**
 * Quantidade a partir das peças e do comprimento (mesma conta do banco):
 * m³ = peças × espessura/100 × largura/100 × comprimento; metro linear =
 * peças × comprimento. Arredonda em 4 casas.
 */
export function quantidadePorPecas(p: MedidasProduto, pecas: Decimal.Value, comprimentoM: Decimal.Value | null): Decimal | null {
  const n = new Decimal(pecas);
  if (!n.isFinite() || n.lte(0)) return null;
  const modo = modoMedida(p);
  if (modo === "direto") return n.toDecimalPlaces(4);
  const comp = comprimentoM == null || comprimentoM === "" ? (p.comprimento_m != null ? new Decimal(p.comprimento_m) : null) : new Decimal(comprimentoM);
  if (!comp || !comp.isFinite() || comp.lte(0)) return null;
  if (modo === "metro") return n.times(comp).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return n
    .times(new Decimal(p.espessura_cm!).div(100))
    .times(new Decimal(p.largura_cm!).div(100))
    .times(comp)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** 0,2160 → "0,216"; 20 → "20". */
export function formatarQuantidade(q: Decimal.Value | null | undefined, casas = 4): string {
  if (q == null || q === "") return "—";
  const d = new Decimal(q);
  if (!d.isFinite()) return "—";
  const [int, frac = ""] = d.toFixed(casas).split(".");
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fracLimpa = frac.replace(/0+$/, "");
  return fracLimpa ? `${intFmt},${fracLimpa}` : intFmt;
}

/** Descrição da medida da peça: "6 × 12 cm". */
export function secaoPeca(p: MedidasProduto): string | null {
  if (p.espessura_cm == null || p.largura_cm == null) return null;
  return `${formatarQuantidade(p.espessura_cm, 2)} × ${formatarQuantidade(p.largura_cm, 2)} cm`;
}

/** Hora local "14:32" (fuso do escritório). */
export function hora(ts: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Araguaina", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

/** Parcelas da venda a prazo (mesma divisão do banco: a última leva os centavos que sobram). */
export function parcelasDoPrazo(valor: Decimal.Value, parcelas: number, primeiroVencimento: string, intervaloDias = 30) {
  const total = new Decimal(valor);
  const base = total.div(parcelas).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const [a, m, d] = primeiroVencimento.split("-").map(Number);
  return Array.from({ length: parcelas }, (_, i) => {
    const venc = new Date(Date.UTC(a, m - 1, d + i * intervaloDias)).toISOString().slice(0, 10);
    return { numero: i + 1, vencimento: venc, valor: i < parcelas - 1 ? base : total.minus(base.times(parcelas - 1)) };
  });
}

/** Unidade como se escreve: M3 → m³, M2 → m², M → m. */
export function un(u: string | null | undefined) {
  return u === "M3" ? "m³" : u === "M2" ? "m²" : u === "M" || u === "ML" ? "m" : (u ?? "");
}

/** Situação da NF-e na hora da venda, para o caixa. */
export interface NfeNaVenda {
  /** A empresa tem a emissão de NF-e configurada (mesmo que desligada). */
  configurada: boolean;
  /** Dá para emitir agora (emissão ligada, operação e inscrição definidas). */
  disponivel: boolean;
  motivo: string | null;
  ambiente: "homologacao" | "producao" | null;
  marcadaPadrao: boolean;
  emitenteId: string | null;
  operacaoId: string | null;
  /** CPF/CNPJ dos clientes que já têm o endereço cadastrado para a nota. */
  documentosComEndereco: string[];
}
