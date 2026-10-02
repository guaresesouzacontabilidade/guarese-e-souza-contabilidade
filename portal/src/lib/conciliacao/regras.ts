import { Decimal, dec } from "@/lib/dinheiro";
import { competenciaAtual, competenciaDe, somarMeses } from "@/lib/competencia";

/**
 * Regras da tela de conciliação (espelham as validações das funções do
 * banco, para avisar antes de enviar). O banco continua sendo a fonte da
 * verdade: tudo é validado de novo em confirmar_conciliacao/conciliar_manual.
 */

export type Tratamento = "juros" | "multa" | "desconto" | "taxa" | "parcial";
export type TipoFinanceiro = "receber" | "pagar";

export const TRATAMENTOS: Record<Tratamento, string> = {
  juros: "Juros",
  multa: "Multa",
  desconto: "Desconto",
  taxa: "Taxa / tarifa",
  parcial: "Pagamento parcial (o restante continua em aberto)",
};

export const TIPOS_CONCILIACAO: Record<string, string> = {
  lancamento: "Lançamento",
  baixa: "Pagamento já registrado",
  transferencia: "Transferência entre contas",
  classificacao: "Lançamento criado na conciliação",
};

export interface EntradaCombinacao {
  movimentos: { valor: string }[];
  lancamentos: { tipo: TipoFinanceiro; aberto: string }[];
  baixas: { tipo: TipoFinanceiro; total: string }[];
}

export interface AnaliseCombinacao {
  ok: boolean;
  erro: string | null;
  tipo: TipoFinanceiro | null;
  /** Valor da(s) movimentação(ões), sem sinal. */
  caixa: string;
  /** Soma do que foi selecionado (saldo em aberto dos lançamentos + baixas). */
  alvos: string;
  /** caixa − alvos: positivo = movimentação maior; negativo = menor. */
  diferenca: string;
  /** Tratamentos aceitos para a diferença (vazio quando não há diferença a tratar). */
  tratamentos: Tratamento[];
}

/** Tratamentos que o banco aceita para uma diferença, conforme o sentido. */
export function tratamentosPermitidos(diferenca: Decimal | string, tipo: TipoFinanceiro): Tratamento[] {
  const d = dec(diferenca);
  if (d.isZero()) return [];
  if (d.isPositive()) return tipo === "receber" ? ["juros", "multa"] : ["juros", "multa", "taxa"];
  return tipo === "receber" ? ["desconto", "taxa", "parcial"] : ["desconto", "parcial"];
}

/** Analisa uma combinação de movimentações com lançamentos/baixas antes de conciliar. */
export function analisarCombinacao(e: EntradaCombinacao): AnaliseCombinacao {
  const zero = "0.00";
  const base = (erro: string | null, extra: Partial<AnaliseCombinacao> = {}): AnaliseCombinacao => ({
    ok: erro === null,
    erro,
    tipo: null,
    caixa: zero,
    alvos: zero,
    diferenca: zero,
    tratamentos: [],
    ...extra,
  });
  if (!e.movimentos.length) return base("Selecione ao menos uma movimentação.");
  const valores = e.movimentos.map((m) => dec(m.valor));
  const positivos = valores.filter((v) => v.isPositive()).length;
  if (positivos > 0 && positivos < valores.length) return base("Não misture entradas e saídas na mesma conciliação.");
  const soma = valores.reduce((a, v) => a.plus(v), new Decimal(0));
  const tipo: TipoFinanceiro = soma.isPositive() ? "receber" : "pagar";
  const caixa = soma.abs();
  const somaBaixas = e.baixas.reduce((a, b) => a.plus(dec(b.total)), new Decimal(0));
  const somaAbertos = e.lancamentos.reduce((a, l) => a.plus(dec(l.aberto)), new Decimal(0));
  const alvos = somaBaixas.plus(somaAbertos);
  const diferenca = caixa.minus(alvos);
  const extra = { tipo, caixa: caixa.toFixed(2), alvos: alvos.toFixed(2), diferenca: diferenca.toFixed(2) };

  if (!e.lancamentos.length && !e.baixas.length) return base("Selecione os lançamentos ou pagamentos correspondentes.", extra);
  if (e.lancamentos.some((l) => l.tipo !== tipo) || e.baixas.some((b) => b.tipo !== tipo)) {
    return base(tipo === "receber" ? "A movimentação é uma entrada: selecione somente contas a receber." : "A movimentação é uma saída: selecione somente contas a pagar.", extra);
  }
  if (!e.lancamentos.length) {
    if (!diferenca.isZero()) return base(`Os valores não conferem (diferença de R$ ${diferenca.abs().toFixed(2).replace(".", ",")}).`, extra);
    return base(null, extra);
  }
  if (e.movimentos.length > 1 && e.lancamentos.length > 1) {
    return base("Concilie uma movimentação com vários lançamentos, ou várias movimentações com um lançamento.", extra);
  }
  if (caixa.minus(somaBaixas).lessThanOrEqualTo(0)) return base("O valor da movimentação já está coberto pelos pagamentos selecionados.", extra);
  return base(null, { ...extra, tratamentos: tratamentosPermitidos(diferenca, tipo) });
}

/** Verifica se o tratamento escolhido é aceito para a análise. */
export function tratamentoValido(a: AnaliseCombinacao, t: Tratamento | null | undefined): boolean {
  if (!a.tratamentos.length) return true;
  return Boolean(t && a.tratamentos.includes(t));
}

/**
 * Ordena candidatos (lançamentos em aberto) pela proximidade de valor e de
 * data em relação à movimentação. Os de sentido diferente ficam de fora.
 */
export function ordenarCandidatos<T extends { tipo: TipoFinanceiro; aberto: string; vencimento: string }>(
  mov: { valor: string; data: string },
  candidatos: T[],
): T[] {
  const valor = dec(mov.valor);
  const tipo: TipoFinanceiro = valor.isPositive() ? "receber" : "pagar";
  const alvo = valor.abs();
  const dias = (d: string) => Math.abs(Date.parse(`${d}T12:00:00Z`) - Date.parse(`${mov.data}T12:00:00Z`)) / 86400000;
  return candidatos
    .filter((c) => c.tipo === tipo)
    .map((c) => ({ c, dv: dec(c.aberto).minus(alvo).abs(), dd: dias(c.vencimento) }))
    .sort((a, b) => a.dv.comparedTo(b.dv) || a.dd - b.dd)
    .map((x) => x.c);
}

/** Competência exibida por padrão: a da movimentação pendente mais antiga, ou o mês anterior. */
export function competenciaPadrao(maisAntigaPendente: string | null | undefined, atual = competenciaAtual()): string {
  if (maisAntigaPendente && /^\d{4}-\d{2}-\d{2}/.test(maisAntigaPendente)) return competenciaDe(maisAntigaPendente);
  return somarMeses(atual, -1);
}

export interface SaldoConta {
  conta_nome: string;
  saldo_extrato: number | string | null;
  diferenca: number | string | null;
  movimentos_pendentes: number;
}

/** Condições para concluir a etapa de conciliação de uma competência. */
export function avaliarFinalizacao(pendentes: number, saldos: SaldoConta[]) {
  const impedimentos: string[] = [];
  const avisos: string[] = [];
  if (pendentes > 0) impedimentos.push(`${pendentes} movimentação(ões) ainda pendente(s) de conciliação.`);
  for (const s of saldos) {
    if (s.saldo_extrato === null || s.saldo_extrato === undefined) {
      if (s.movimentos_pendentes > 0 || s.diferenca !== null) avisos.push(`${s.conta_nome}: sem saldo do extrato para conferir.`);
      continue;
    }
    const d = dec(String(s.diferenca ?? 0));
    if (!d.isZero()) avisos.push(`${s.conta_nome}: saldo do sistema difere do extrato em R$ ${d.toFixed(2).replace(".", ",")}.`);
  }
  return { pode: impedimentos.length === 0, impedimentos, avisos, exigeJustificativa: avisos.length > 0 };
}

export interface LinhaEscritorio {
  id: string;
  nome: string;
  pendentes: number;
  valorPendente: string;
  maisAntiga: string | null;
  sugestoes: number;
  ultimaConciliacao: string | null;
  contas: number;
}

/** Consolida, por empresa, os números da conciliação para a visão do escritório. */
export function consolidarEscritorio(
  empresas: { id: string; nome: string }[],
  movimentosPendentes: { empresa_id: string; data: string; valor: number | string }[],
  sugestoes: { empresa_id: string }[],
  confirmadas: { empresa_id: string; confirmada_em: string | null }[],
  contas: { empresa_id: string }[] = [],
): LinhaEscritorio[] {
  const linhas = new Map<string, LinhaEscritorio & { soma: Decimal }>();
  for (const e of empresas) {
    linhas.set(e.id, { id: e.id, nome: e.nome, pendentes: 0, valorPendente: "0.00", soma: new Decimal(0), maisAntiga: null, sugestoes: 0, ultimaConciliacao: null, contas: 0 });
  }
  for (const m of movimentosPendentes) {
    const l = linhas.get(m.empresa_id);
    if (!l) continue;
    l.pendentes++;
    l.soma = l.soma.plus(dec(String(m.valor)).abs());
    if (!l.maisAntiga || m.data < l.maisAntiga) l.maisAntiga = m.data;
  }
  for (const s of sugestoes) {
    const l = linhas.get(s.empresa_id);
    if (l) l.sugestoes++;
  }
  for (const c of confirmadas) {
    const l = linhas.get(c.empresa_id);
    if (l && c.confirmada_em && (!l.ultimaConciliacao || c.confirmada_em > l.ultimaConciliacao)) l.ultimaConciliacao = c.confirmada_em;
  }
  for (const c of contas) {
    const l = linhas.get(c.empresa_id);
    if (l) l.contas++;
  }
  return [...linhas.values()].map(({ soma, ...l }) => ({ ...l, valorPendente: soma.toFixed(2) }));
}
