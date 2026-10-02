/** Rótulos em português para valores armazenados no banco. */

export const REGIMES: Record<string, string> = {
  mei: "MEI",
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  imune_isenta: "Imune / Isenta",
  produtor_rural: "Produtor rural",
  pessoa_fisica: "Pessoa física",
  outro: "Outro",
};

export const SERVICOS: Record<string, string> = {
  contabil: "Contábil",
  fiscal: "Fiscal",
  folha: "Folha de pagamento",
  financeiro: "Financeiro (BPO)",
  societario: "Societário",
  imposto_renda: "Imposto de renda",
};

export const FUNCOES_CONTATO: Record<string, string> = {
  socio_administrador: "Sócio administrador",
  socio: "Sócio",
  financeiro: "Financeiro",
  rh: "RH / Departamento pessoal",
  fiscal: "Fiscal",
  outro: "Outro",
};

export const STATUS_DOCUMENTO: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  recebido: { rotulo: "Recebido", tom: "info" },
  em_analise: { rotulo: "Em análise", tom: "alerta" },
  aprovado: { rotulo: "Aprovado", tom: "sucesso" },
  correcao: { rotulo: "Precisa de correção", tom: "perigo" },
};

export const STATUS_CHECKLIST: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  pendente: { rotulo: "Faltante", tom: "neutro" },
  enviado: { rotulo: "Enviado — aguardando conferência", tom: "info" },
  em_analise: { rotulo: "Em análise", tom: "alerta" },
  correcao: { rotulo: "Precisa de correção", tom: "perigo" },
  concluido: { rotulo: "Concluído", tom: "sucesso" },
  nao_se_aplica_solicitado: { rotulo: "“Não se aplica” em revisão", tom: "alerta" },
  nao_se_aplica: { rotulo: "Não se aplica", tom: "neutro" },
};

export const TIPOS_CONTA: Record<string, string> = {
  conta_corrente: "Conta corrente",
  poupanca: "Poupança",
  investimento: "Investimento",
  caixa: "Caixa (dinheiro)",
  cartao_credito: "Cartão de crédito",
  adquirente: "Maquininha / adquirente",
  outra: "Outra",
};

export const TIPOS_CATEGORIA: Record<string, { rotulo: string; grupo: string; dre: boolean }> = {
  receita_operacional: { rotulo: "Receita operacional (faturamento)", grupo: "Receitas", dre: true },
  deducao_receita: { rotulo: "Dedução da receita (impostos s/ vendas, devoluções)", grupo: "Deduções", dre: true },
  custo_mercadoria: { rotulo: "Custo de mercadorias/insumos (CMV)", grupo: "Custos", dre: true },
  custo_servico: { rotulo: "Custo dos serviços prestados", grupo: "Custos", dre: true },
  despesa_operacional: { rotulo: "Despesa operacional", grupo: "Despesas", dre: true },
  receita_financeira: { rotulo: "Receita financeira", grupo: "Resultado financeiro", dre: true },
  despesa_financeira: { rotulo: "Despesa financeira (juros, tarifas, taxas)", grupo: "Resultado financeiro", dre: true },
  outras_receitas: { rotulo: "Outras receitas não operacionais", grupo: "Outros", dre: true },
  outras_despesas: { rotulo: "Outras despesas não operacionais", grupo: "Outros", dre: true },
  impostos_lucro: { rotulo: "Impostos sobre o lucro (IRPJ/CSLL)", grupo: "Impostos sobre o lucro", dre: true },
  investimento: { rotulo: "Investimento (imobilizado) — fora da DRE", grupo: "Fora do resultado", dre: false },
  aporte_socio: { rotulo: "Aporte dos sócios — não é faturamento", grupo: "Fora do resultado", dre: false },
  retirada_socio: { rotulo: "Retirada / distribuição aos sócios", grupo: "Fora do resultado", dre: false },
  despesa_pessoal_socio: { rotulo: "Despesa pessoal do sócio paga pela empresa", grupo: "Fora do resultado", dre: false },
  emprestimo_captacao: { rotulo: "Empréstimo recebido — não é receita", grupo: "Fora do resultado", dre: false },
  emprestimo_amortizacao: { rotulo: "Amortização de empréstimo (principal)", grupo: "Fora do resultado", dre: false },
};

export const SITUACAO_LANCAMENTO: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  aberto: { rotulo: "Em aberto", tom: "info" },
  parcial: { rotulo: "Parcial", tom: "alerta" },
  quitado: { rotulo: "Quitado", tom: "sucesso" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
  atrasado: { rotulo: "Atrasado", tom: "perigo" },
};

export const ORIGEM_LANCAMENTO: Record<string, string> = {
  manual: "Manual",
  importacao: "Importação",
  nfe: "XML de NF-e",
  nfse: "NFS-e",
  cte: "CT-e",
  recorrencia: "Recorrência",
  parcelamento: "Parcelamento",
  conciliacao: "Conciliação",
  ocr: "Leitura de documento",
  maquininha: "Maquininha",
  cartao: "Cartão de crédito",
};

export const ETAPAS_FECHAMENTO: Record<string, string> = {
  coleta: "Coleta de documentos",
  conferencia: "Conferência",
  conciliacao: "Conciliação",
  revisao: "Revisão",
  publicacao: "Publicação dos relatórios",
};

export const STATUS_ETAPA: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  nao_iniciada: { rotulo: "Não iniciada", tom: "neutro" },
  em_andamento: { rotulo: "Em andamento", tom: "alerta" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
};

export const STATUS_COMPETENCIA: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  aberta: { rotulo: "Aberta", tom: "info" },
  em_fechamento: { rotulo: "Em fechamento", tom: "alerta" },
  fechada: { rotulo: "Fechada", tom: "sucesso" },
};

export const STATUS_ENVIO: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  pendente: { rotulo: "Na fila", tom: "info" },
  enviado: { rotulo: "Enviado", tom: "sucesso" },
  falhou: { rotulo: "Falhou", tom: "perigo" },
  nao_configurado: { rotulo: "Não enviado (canal não configurado)", tom: "alerta" },
  desativado: { rotulo: "Desativado", tom: "neutro" },
};
