/** Rótulos da conferência do SPED Fiscal × XML. */

export const GRAVIDADE_SPED: Record<string, { rotulo: string; variante: "perigo" | "alerta" | "neutro" }> = {
  alta: { rotulo: "Corrigir", variante: "perigo" },
  media: { rotulo: "Conferir", variante: "alerta" },
  baixa: { rotulo: "Informação", variante: "neutro" },
};

export const REGRAS_SPED: Record<string, { titulo: string; explicacao: string }> = {
  nao_escriturada_saida: {
    titulo: "Nota emitida e não escriturada",
    explicacao: "Nota emitida pela empresa no período (XML autorizado no portal) que não está no arquivo. Toda saída do mês precisa constar na EFD.",
  },
  cancelada_escriturada: {
    titulo: "Nota cancelada escriturada como regular",
    explicacao: "O portal tem o evento de cancelamento, mas a nota entrou como regular: o imposto dela está sendo apurado.",
  },
  valor_divergente: {
    titulo: "Valor total diferente do XML",
    explicacao: "O valor total escriturado (VL_DOC) não bate com o total da nota no XML.",
  },
  icms_divergente: {
    titulo: "ICMS diferente do destacado",
    explicacao: "Nas notas emitidas, o ICMS escriturado precisa ser o destacado no XML.",
  },
  icms_st_divergente: {
    titulo: "ICMS-ST diferente do destacado",
    explicacao: "Nas notas emitidas, o ICMS retido por substituição escriturado precisa ser o do XML.",
  },
  ipi_divergente: {
    titulo: "IPI diferente do destacado",
    explicacao: "Nas notas emitidas, o IPI escriturado precisa ser o destacado no XML.",
  },
  duplicada: {
    titulo: "Nota em duplicidade",
    explicacao: "A mesma chave aparece mais de uma vez no arquivo.",
  },
  nao_escriturada_entrada: {
    titulo: "Nota recebida e não escriturada",
    explicacao:
      "Nota emitida para a empresa no período que não está neste arquivo nem nos outros SPED da empresa no portal. Se a mercadoria chegou no mês seguinte, entra naquele mês; se a operação não aconteceu, registre o desconhecimento.",
  },
  credito_nao_aproveitado: {
    titulo: "Possível crédito de ICMS não aproveitado",
    explicacao:
      "Compra para revenda ou industrialização (CFOP 1101, 1102, 2101 ou 2102) com ICMS destacado no XML e sem crédito escriturado. Confira se a empresa tem direito ao crédito (regime normal de apuração).",
  },
  cancelada_no_sped: {
    titulo: "Escriturada como cancelada sem o evento",
    explicacao: "A nota foi informada como cancelada, mas o portal não tem o evento de cancelamento. Se foi cancelada mesmo, envie o XML do evento.",
  },
  cancelada_nao_informada: {
    titulo: "Nota cancelada não informada",
    explicacao: "Nota própria cancelada no período: o Guia Prático pede que ela conste no C100 com a situação 02 (cancelada) e a chave.",
  },
  sem_xml: {
    titulo: "Nota escriturada sem XML no portal",
    explicacao: "O XML não está no portal: peça ao cliente ou ative as notas automáticas para completar a conferência.",
  },
};

export const ORDEM_REGRAS = Object.keys(REGRAS_SPED);

export const SITUACAO_SPED: Record<string, { rotulo: string; variante: "sucesso" | "alerta" | "perigo" | "neutro" | "info" }> = {
  processando: { rotulo: "Lendo", variante: "info" },
  conferido: { rotulo: "Conferido", variante: "sucesso" },
  nao_suportado: { rotulo: "Guardado (sem leitura)", variante: "neutro" },
  erro: { rotulo: "Com problema", variante: "perigo" },
};

export const TIPO_SPED: Record<string, string> = {
  efd_icms_ipi: "EFD ICMS/IPI",
  efd_contribuicoes: "EFD-Contribuições",
};
