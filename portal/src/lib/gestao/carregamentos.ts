import Decimal from "decimal.js";

/** Rótulos e contas das ordens de carregamento (usados no navegador e no servidor). */

export type StatusOrdem = "aberta" | "carregada" | "faturada" | "cancelada";

export const STATUS_ORDEM: Record<
  StatusOrdem,
  {
    rotulo: string;
    variante: "info" | "alerta" | "sucesso" | "neutro" | "perigo";
  }
> = {
  aberta: { rotulo: "Aguardando carregar", variante: "info" },
  carregada: { rotulo: "Carregada (falta a NF-e)", variante: "alerta" },
  faturada: { rotulo: "Com NF-e", variante: "sucesso" },
  cancelada: { rotulo: "Cancelada", variante: "perigo" },
};

/** Modalidade do frete (mesmos códigos da NF-e). */
export const FRETE_POR_CONTA: Record<number, string> = {
  0: "Do vendedor (CIF)",
  1: "Do comprador (FOB)",
  2: "De terceiros",
  3: "Transporte próprio do vendedor",
  4: "Transporte próprio do comprador",
  9: "Sem frete",
};

export const MODALIDADES_GESTAO = {
  loja: "Loja completa (caixa, vendas, estoque e notas)",
  notas: "Notas e transporte (ordens de carregamento e NF-e, sem caixa)",
} as const;

/** Situações em que a NF-e da ordem não vale mais (a ordem pode ser corrigida e ganhar outra nota). */
const NOTA_SEM_EFEITO = new Set(["cancelada", "descartada", "rejeitada", "denegada"]);

export function notaVale(situacao: string | null | undefined): boolean {
  return Boolean(situacao) && !NOTA_SEM_EFEITO.has(situacao!);
}

const PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

/** Placa digitada ("abc-1d23") → padrão do banco ("ABC1D23"); null quando vazia. */
export function limparPlaca(v: string | null | undefined): string | null {
  const p = String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return p || null;
}

export function placaValida(v: string) {
  return PLACA.test(v);
}

/** Placa para mostrar: antiga com traço (ABC-1234), Mercosul sem (ABC1D23). */
export function mostrarPlaca(v: string | null | undefined): string {
  if (!v) return "—";
  return /^[A-Z]{3}[0-9]{4}$/.test(v) ? `${v.slice(0, 3)}-${v.slice(3)}` : v;
}

const KG = new Set(["KG", "KGS", "QUILO"]);
const TONELADA = new Set(["T", "TON", "TN", "TONELADA"]);

/**
 * Quantidade da NF-e (na unidade do produto) a partir do peso líquido da
 * balança: KG fica igual; tonelada divide por 1.000; sacas e outras unidades
 * usam o peso de cada unidade do cadastro (ex.: saca de 60 kg). Sem como
 * converter, devolve null (a nota usa a quantidade prevista e a pessoa confere).
 */
export function quantidadePelaPesagem(pesoLiquidoKg: Decimal.Value, unidade: string, pesoKgUnidade: Decimal.Value | null | undefined): Decimal | null {
  const peso = new Decimal(pesoLiquidoKg);
  if (peso.lte(0)) return null;
  const u = unidade.trim().toUpperCase();
  if (KG.has(u)) return peso.toDecimalPlaces(4);
  if (TONELADA.has(u)) return peso.div(1000).toDecimalPlaces(4);
  if (pesoKgUnidade != null && new Decimal(pesoKgUnidade).gt(0)) return peso.div(pesoKgUnidade).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return null;
}

/** Peso formatado em kg ("36.020 kg"; com casas só quando houver). */
export function formatarKg(v: Decimal.Value | null | undefined): string {
  if (v == null) return "—";
  const d = new Decimal(v);
  return `${d.toNumber().toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
}

/** Texto da pesagem para as informações complementares da NF-e. */
export function textoPesagem(o: {
  numero: number;
  peso_bruto_kg: Decimal.Value | null;
  tara_kg: Decimal.Value | null;
  peso_liquido_kg: Decimal.Value | null;
  umidade: Decimal.Value | null;
  impureza: Decimal.Value | null;
  ticket_balanca: string | null;
  contrato: string | null;
  motorista_nome: string | null;
}): string {
  const partes = [`Ordem de carregamento nº ${o.numero}.`];
  if (o.contrato) partes.push(`Contrato ${o.contrato}.`);
  if (o.peso_liquido_kg != null) {
    partes.push(
      `Pesagem: bruto ${formatarKg(o.peso_bruto_kg)}, tara ${formatarKg(o.tara_kg)}, líquido ${formatarKg(o.peso_liquido_kg)}${o.ticket_balanca ? ` (ticket ${o.ticket_balanca})` : ""}.`,
    );
  }
  const classif = [
    o.umidade != null ? `umidade ${new Decimal(o.umidade).toNumber().toLocaleString("pt-BR")}%` : null,
    o.impureza != null ? `impureza ${new Decimal(o.impureza).toNumber().toLocaleString("pt-BR")}%` : null,
  ].filter(Boolean);
  if (classif.length) partes.push(`Classificação na origem: ${classif.join(", ")}.`);
  if (o.motorista_nome) partes.push(`Motorista: ${o.motorista_nome}.`);
  return partes.join(" ");
}
