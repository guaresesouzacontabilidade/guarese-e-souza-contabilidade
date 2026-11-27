/** Tipos compartilhados entre as telas e as ações de conciliação bancária. */

export const TRATAMENTOS = ["juros", "multa", "desconto", "taxa", "parcial"] as const;
export type Tratamento = (typeof TRATAMENTOS)[number];

export const ROTULO_TRATAMENTO: Record<Tratamento, string> = {
  juros: "Juros",
  multa: "Multa",
  desconto: "Desconto",
  taxa: "Taxa / tarifa",
  parcial: "Pagamento parcial (o restante continua em aberto)",
};

/**
 * Tratamentos aceitos para a diferença entre o valor da movimentação e o saldo
 * em aberto (mesmas regras validadas no banco).
 *  - diferença > 0 (entrou/saiu a mais): juros, multa; taxa apenas em pagamentos;
 *  - diferença < 0 (entrou/saiu a menos): desconto, parcial; taxa apenas em recebimentos
 *    (ex.: taxa descontada pela maquininha ou pelo banco).
 */
export function tratamentosPermitidos(diferenca: number, tipo: "receber" | "pagar"): Tratamento[] {
  if (diferenca > 0) return tipo === "pagar" ? ["juros", "multa", "taxa"] : ["juros", "multa"];
  if (diferenca < 0) return tipo === "receber" ? ["desconto", "taxa", "parcial"] : ["desconto", "parcial"];
  return [];
}

export interface MovimentoCandidato {
  id: string;
  data: string;
  valor: string;
  descricao: string;
  conta_id: string;
  conta_nome: string;
}

export interface LancamentoCandidato {
  id: string;
  descricao: string;
  contraparte: string | null;
  vencimento: string;
  previsto: string;
  aberto: string;
  numero_documento: string | null;
  parcial: boolean;
}

export interface BaixaCandidata {
  id: string;
  data: string;
  total: string;
  descricao: string;
}

export interface TransferenciaCandidata {
  id: string;
  data: string;
  valor: string;
  descricao: string;
  origem: string;
  destino: string;
}

export interface CandidatosConciliacao {
  tipo: "receber" | "pagar";
  conta_id: string;
  movimentos: MovimentoCandidato[];
  lancamentos: LancamentoCandidato[];
  lancamentos_sugeridos: number;
  baixas: BaixaCandidata[];
  transferencias: TransferenciaCandidata[];
  outras_contas_movimentos: MovimentoCandidato[];
  contas: { id: string; nome: string; tipo: string }[];
}
