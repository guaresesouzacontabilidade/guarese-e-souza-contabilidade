import type { TipoFinanceiro } from "@/lib/conciliacao/regras";

/** Dados serializáveis passados do servidor para os componentes da conciliação. */

export interface MovimentoTela {
  id: string;
  conta_id: string;
  conta: string;
  data: string;
  valor: string; // com sinal: + entrada, − saída
  descricao: string;
  documento: string | null;
  status: "pendente" | "conciliado" | "ignorado";
  ignorado_motivo: string | null;
  conciliacao_id: string | null;
  conciliacao_tipo: string | null;
  conciliada_em: string | null;
  em_sugestao: boolean;
}

export interface LancamentoAberto {
  id: string;
  tipo: TipoFinanceiro;
  descricao: string;
  aberto: string;
  vencimento: string;
  contraparte: string | null;
  numero: string | null;
}

export interface BaixaLivre {
  id: string;
  tipo: TipoFinanceiro;
  total: string;
  data: string;
  conta_id: string;
  descricao: string;
}

export interface TransferenciaLivre {
  id: string;
  data: string;
  valor: string;
  origem_id: string;
  destino_id: string;
  origem: string;
  destino: string;
  descricao: string | null;
  origem_conciliada: boolean;
  destino_conciliada: boolean;
}

export interface SugestaoTela {
  id: string;
  tipo: string;
  pontuacao: number | null;
  observacao: string | null;
  criterios: Record<string, unknown>;
  movimentos: { id: string; data: string; descricao: string; valor: string; conta: string }[];
  lancamentos: LancamentoAberto[];
  baixas: BaixaLivre[];
  /** Algum alvo deixou de estar disponível (quitado, cancelado, excluído). */
  incompleta: boolean;
}

export interface Opcao {
  id: string;
  nome: string;
}

export interface CategoriaOpcao extends Opcao {
  natureza: string;
}
