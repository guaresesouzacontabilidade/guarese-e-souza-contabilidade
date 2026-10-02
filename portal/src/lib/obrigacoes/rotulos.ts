/** Rótulos da camada operacional (obrigações, regras e tarefas). */

export type Tom = "neutro" | "info" | "sucesso" | "alerta" | "perigo";

export const STATUS_TAREFA: Record<string, { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: "A fazer", tom: "neutro" },
  em_andamento: { rotulo: "Em andamento", tom: "info" },
  aguardando_cliente: { rotulo: "Aguardando cliente", tom: "alerta" },
  em_revisao: { rotulo: "Em revisão", tom: "info" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  dispensada: { rotulo: "Dispensada", tom: "neutro" },
};

export const STATUS_ABERTOS = ["pendente", "em_andamento", "aguardando_cliente", "em_revisao"] as const;

export const ETAPAS: Record<string, { rotulo: string; concluida: string; prazo: string }> = {
  apuracao: { rotulo: "Apuração", concluida: "Apurada", prazo: "Meta interna" },
  entrega: { rotulo: "Entrega", concluida: "Transmitida", prazo: "Prazo de entrega" },
  pagamento: { rotulo: "Pagamento", concluida: "Paga", prazo: "Vencimento" },
};

export const SITUACAO_CALENDARIO: Record<string, { rotulo: string; tom: Tom; ordem: number }> = {
  aplica: { rotulo: "Aplica-se", tom: "sucesso", ordem: 1 },
  sem_prazo: { rotulo: "Prazo a regulamentar", tom: "info", ordem: 2 },
  falta_cadastro: { rotulo: "Cadastro incompleto", tom: "alerta", ordem: 3 },
  aguardando_validacao: { rotulo: "Aguardando validação", tom: "alerta", ordem: 4 },
  sem_regra: { rotulo: "Sem regra validada", tom: "perigo", ordem: 5 },
  fora_da_periodicidade: { rotulo: "Fora da periodicidade", tom: "neutro", ordem: 6 },
  fora_da_vigencia: { rotulo: "Fora da vigência", tom: "neutro", ordem: 7 },
  excluida: { rotulo: "Excluída para a empresa", tom: "neutro", ordem: 8 },
  nao_aplica: { rotulo: "Não se aplica", tom: "neutro", ordem: 9 },
};

export const ESFERAS: Record<string, string> = {
  federal: "Federal",
  nacional: "Nacional (IBS/CBS)",
  estadual: "Estadual",
  municipal: "Municipal",
};

export const AREAS: Record<string, string> = {
  fiscal: "Fiscal",
  contabil: "Contábil",
  pessoal: "Pessoal",
  societario: "Societário",
};

export const PERIODICIDADES: Record<string, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  anual: "Anual",
};

export const TRIBUTOS = ["SIMPLES", "IRPJ", "CSLL", "PIS", "COFINS", "IPI", "ICMS", "ISS", "INSS", "FGTS", "IRRF", "CBS", "IBS", "IS"] as const;

export const STATUS_NORMA: Record<string, { rotulo: string; tom: Tom }> = {
  proposta: { rotulo: "Aguardando validação", tom: "alerta" },
  validada: { rotulo: "Validada — falta aplicar", tom: "info" },
  aplicada: { rotulo: "Aplicada", tom: "sucesso" },
  rejeitada: { rotulo: "Rejeitada", tom: "neutro" },
};

export const TIPO_NORMA: Record<string, string> = {
  nova_regra: "Nova regra",
  alteracao_regra: "Alteração de regra",
  revogacao: "Encerramento de regra",
};

export const STATUS_REGRA: Record<string, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "Proposta", tom: "alerta" },
  validada: { rotulo: "Em vigor", tom: "sucesso" },
  revogada: { rotulo: "Encerrada", tom: "neutro" },
};

export const TIPOS_FERIADO: Record<string, string> = {
  feriado: "Feriado",
  ponto_facultativo: "Ponto facultativo",
  sem_expediente_bancario: "Sem expediente bancário",
};

export const ABRANGENCIAS: Record<string, string> = {
  nacional: "Nacional",
  estadual: "Estadual",
  municipal: "Municipal",
};

export const MODOS_CONFIG: Record<string, { rotulo: string; tom: Tom }> = {
  automatico: { rotulo: "Automático (pela regra)", tom: "neutro" },
  incluida: { rotulo: "Incluída manualmente", tom: "info" },
  excluida: { rotulo: "Excluída para a empresa", tom: "alerta" },
};

export const LUCRO_REAL_APURACAO: Record<string, string> = {
  trimestral: "Trimestral",
  anual: "Anual (estimativa mensal)",
};

export const ACAO_HISTORICO_TAREFA: Record<string, string> = {
  status: "Situação alterada",
  atualizacao: "Atualização",
  atribuicao: "Responsáveis alterados",
  guia_vinculada: "Guia do portal vinculada",
  pagamento_informado: "Pagamento informado pelo cliente",
  prazo_recalculado: "Prazo recalculado",
  dispensada_por_norma: "Dispensada por mudança normativa",
  dispensada_automaticamente: "Dispensada automaticamente",
};

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;
