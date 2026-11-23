import { diasEntre } from "@/lib/competencia";
import { Decimal, dec, type ValorEntrada } from "@/lib/dinheiro";

/** Rótulos e contas dos honorários (valem na tela, no servidor e nos testes). */

export type SituacaoCobranca = "rascunho" | "aberta" | "paga" | "cancelada";

export const SITUACOES_COBRANCA: Record<SituacaoCobranca, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "perigo" | "alerta" }> = {
  rascunho: { rotulo: "Para conferir", tom: "neutro" },
  aberta: { rotulo: "Em aberto", tom: "info" },
  paga: { rotulo: "Paga", tom: "sucesso" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

export const SERVICOS_HONORARIOS = {
  contabil: "Contabilidade",
  fiscal: "Fiscal",
  folha: "Folha de pagamento",
  societario: "Societário",
  irpf: "IR dos sócios",
  bpo_financeiro: "Financeiro (BPO)",
  consultoria: "Consultoria",
  outros: "Outros",
} as const;
export type ServicoHonorario = keyof typeof SERVICOS_HONORARIOS;

export const INDICES_REAJUSTE = { nenhum: "Sem reajuste automático", ipca: "IPCA", igpm: "IGP-M", inpc: "INPC" } as const;

export const TIPOS_CATEGORIA_ESCRITORIO = {
  receita_operacional: "Receita de serviços",
  deducao_receita: "Imposto sobre faturamento ou desconto",
  custo_servico: "Custo dos serviços (equipe, sistemas)",
  despesa_operacional: "Despesa do escritório",
  receita_financeira: "Receita financeira",
  despesa_financeira: "Despesa financeira (tarifas, juros)",
  outras_receitas: "Outras receitas",
  outras_despesas: "Outras despesas",
  impostos_lucro: "IRPJ e CSLL",
  investimento: "Investimento (fora da DRE)",
  aporte_socio: "Dinheiro dos sócios (fora da DRE)",
  retirada_socio: "Retirada dos sócios (fora da DRE)",
} as const;
export type TipoCategoriaEscritorio = keyof typeof TIPOS_CATEGORIA_ESCRITORIO;

/** Linhas que ficam fora da DRE (mostradas à parte). */
export const FORA_DA_DRE: TipoCategoriaEscritorio[] = ["investimento", "aporte_socio", "retirada_socio"];

const RECEITAS: TipoCategoriaEscritorio[] = ["receita_operacional", "receita_financeira", "outras_receitas", "aporte_socio"];
export function naturezaDoTipo(tipo: string): "receita" | "despesa" {
  return (RECEITAS as string[]).includes(tipo) ? "receita" : "despesa";
}

/** "0007/2026" */
export function numeroCobranca(c: { ano: number; numero: number }) {
  return `${String(c.numero).padStart(4, "0")}/${c.ano}`;
}

/** Situação para mostrar: a aberta que passou do vencimento aparece como vencida. */
export function situacaoExibida(c: { situacao: string; vencimento: string }, hoje: string) {
  if (c.situacao === "aberta" && c.vencimento < hoje) return { rotulo: "Vencida", tom: "perigo" as const };
  if (c.situacao === "aberta" && c.vencimento === hoje) return { rotulo: "Vence hoje", tom: "alerta" as const };
  return SITUACOES_COBRANCA[c.situacao as SituacaoCobranca] ?? { rotulo: c.situacao, tom: "neutro" as const };
}

/**
 * Multa fixa e juros simples por dia de atraso (iguais aos do banco:
 * app.honorarios_encargos). Sem atraso, zero.
 */
export function encargos(valor: ValorEntrada, vencimento: string, data: string, multaPercentual: ValorEntrada, jurosMesPercentual: ValorEntrada) {
  const dias = diasEntre(vencimento, data);
  const base = dec(valor);
  if (dias <= 0) return { dias: 0, multa: new Decimal(0), juros: new Decimal(0), total: base };
  const multa = base.times(dec(multaPercentual)).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const juros = base.times(dec(jurosMesPercentual)).dividedBy(100).dividedBy(30).times(dias).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { dias, multa, juros, total: base.plus(multa).plus(juros) };
}
