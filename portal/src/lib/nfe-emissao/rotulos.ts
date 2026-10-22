/** Textos da emissão de NF-e nas telas. */

export type SituacaoNfe =
  | "na_fila"
  | "enviando"
  | "aguardando"
  | "autorizada"
  | "rejeitada"
  | "denegada"
  | "falha"
  | "cancelando"
  | "cancelada"
  | "descartada";

type Tom = "neutro" | "info" | "sucesso" | "alerta" | "perigo";

export const SITUACAO_NFE: Record<SituacaoNfe, { rotulo: string; tom: Tom; ajuda: string }> = {
  na_fila: { rotulo: "Emitindo", tom: "info", ajuda: "A nota está sendo enviada à SEFAZ." },
  enviando: { rotulo: "Emitindo", tom: "info", ajuda: "A nota está sendo enviada à SEFAZ." },
  aguardando: { rotulo: "Na SEFAZ", tom: "info", ajuda: "A SEFAZ recebeu a nota e ainda está processando. O portal consulta de novo sozinho." },
  autorizada: { rotulo: "Autorizada", tom: "sucesso", ajuda: "Nota autorizada pela SEFAZ: vale como documento fiscal." },
  rejeitada: { rotulo: "Rejeitada", tom: "perigo", ajuda: "A SEFAZ recusou a nota. Veja o motivo, corrija e envie de novo (o número é o mesmo)." },
  denegada: { rotulo: "Denegada", tom: "perigo", ajuda: "A SEFAZ denegou o uso da nota por irregularidade cadastral. O número fica usado. Fale com o escritório." },
  falha: { rotulo: "Sem resposta", tom: "alerta", ajuda: "A SEFAZ não respondeu. O portal tenta de novo sozinho (consultando antes, para não emitir duas vezes)." },
  cancelando: { rotulo: "Cancelando", tom: "info", ajuda: "O pedido de cancelamento está sendo enviado à SEFAZ." },
  cancelada: { rotulo: "Cancelada", tom: "neutro", ajuda: "O cancelamento foi registrado na SEFAZ." },
  descartada: { rotulo: "Descartada", tom: "neutro", ajuda: "Nota rejeitada que não será corrigida. O número precisa ser inutilizado na SEFAZ." },
};

export const EM_ANDAMENTO: SituacaoNfe[] = ["na_fila", "enviando", "aguardando", "cancelando"];

export const AMBIENTE_NFE = {
  homologacao: { rotulo: "Teste — homologação (sem valor fiscal)", ajuda: "Ambiente de testes da SEFAZ: a nota não tem valor fiscal." },
  producao: { rotulo: "Produção (vale de verdade)", ajuda: "A nota tem valor fiscal e entra nas notas da empresa." },
} as const;

export const CRT = {
  1: "1 - Simples Nacional",
  2: "2 - Simples Nacional, excesso do sublimite",
  3: "3 - Regime normal (Lucro Real ou Presumido)",
  4: "4 - MEI",
} as const;

export const PRESENCA = {
  9: "9 - Operação não presencial (outros)",
  1: "1 - Presencial",
  2: "2 - Pela internet",
  3: "3 - Teleatendimento",
  4: "4 - Entrega em domicílio",
  5: "5 - Presencial, fora do estabelecimento",
  0: "0 - Não se aplica (complementar/ajuste)",
} as const;

export const FINALIDADE = { 1: "Normal (venda, remessa...)", 2: "Complementar", 3: "Ajuste", 4: "Devolução" } as const;

export const DESTINO = { interna: "Dentro do estado (CFOP 5.xxx)", interestadual: "Para outro estado (CFOP 6.xxx)", exterior: "Para o exterior (CFOP 7.xxx)" } as const;

export const MODALIDADE_FRETE = {
  0: "Por conta do vendedor (CIF)",
  1: "Por conta do comprador (FOB)",
  2: "Por conta de terceiros",
  3: "Transporte próprio do vendedor",
  4: "Transporte próprio do comprador",
  9: "Sem frete (retirada ou entrega sem transporte)",
} as const;

export const FORMAS_PAGAMENTO = {
  "15": "Boleto bancário",
  "17": "PIX",
  "18": "Transferência bancária / depósito",
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de crédito",
  "04": "Cartão de débito",
  "05": "Crédito loja",
  "90": "Sem pagamento (remessa, devolução, bonificação)",
  "99": "Outros",
} as const;

export const INDICADOR_IE = {
  1: "Contribuinte do ICMS (tem inscrição estadual)",
  2: "Contribuinte isento de inscrição",
  9: "Não contribuinte (pessoa física, consumidor)",
} as const;

export const ORIGENS = {
  0: "0 - Nacional",
  1: "1 - Estrangeira, importação direta",
  2: "2 - Estrangeira, adquirida no mercado interno",
  3: "3 - Nacional com mais de 40% de importação",
  4: "4 - Nacional, processos produtivos básicos",
  5: "5 - Nacional com até 40% de importação",
  6: "6 - Estrangeira sem similar nacional (importação direta)",
  7: "7 - Estrangeira sem similar nacional (mercado interno)",
  8: "8 - Nacional com mais de 70% de importação",
} as const;

export const CST_PIS_COFINS: Record<string, string> = {
  "01": "01 - Tributável (alíquota básica)",
  "02": "02 - Tributável (alíquota diferenciada)",
  "04": "04 - Monofásica, revenda a alíquota zero",
  "05": "05 - Substituição tributária",
  "06": "06 - Alíquota zero",
  "07": "07 - Isenta",
  "08": "08 - Sem incidência",
  "09": "09 - Suspensão",
  "49": "49 - Outras operações de saída",
  "99": "99 - Outras operações",
};

/** CST do PIS/Cofins que não cobram as contribuições na saída (monofásico, ST, alíquota zero, isenção, sem incidência e suspensão). */
export const SEM_PIS_COFINS = ["04", "05", "06", "07", "08", "09"];

/** Exportação (7.xxx) e venda com fim específico de exportação (5.501, 5.502, 6.501, 6.502): sem PIS/Cofins por lei. */
export function cfopExportacao(cfop: string) {
  const c = cfop.replace(/\D/g, "");
  return c.startsWith("7") || ["5501", "5502", "6501", "6502"].includes(c);
}

export const TIPO_CONTRIBUICAO = {
  upf_por_tonelada: "% da UPF por tonelada (ex.: FETHAB)",
  valor_por_tonelada: "R$ por tonelada",
  percentual_valor: "% do valor dos produtos",
} as const;

export const MODO_FUNRURAL = {
  retido_adquirente: "Retido pelo comprador (venda a empresa)",
  recolhido_produtor: "Recolhido pelo produtor",
} as const;

export const TIPO_GUIA: Record<string, string> = {
  icms_operacao: "ICMS da operação",
  icms_frete: "ICMS do frete",
  difal: "DIFAL (complementação de alíquota)",
  fcp_difal: "FCP do DIFAL",
  contribuicao: "Contribuição estadual",
};

export const SITUACAO_GUIA = {
  a_gerar: { rotulo: "A gerar", tom: "alerta" as Tom, ajuda: "Gere a guia no site oficial e anexe o PDF." },
  gerada: { rotulo: "Na agenda", tom: "sucesso" as Tom, ajuda: "PDF anexado: a guia está na agenda de pagamentos do cliente." },
  dispensada: { rotulo: "Não se aplica", tom: "neutro" as Tom, ajuda: "O escritório marcou que esta guia não precisa ser paga." },
};

/**
 * Onde gerar a guia oficial. A SEFAZ-MT não tem serviço para sistemas de
 * fora gerarem o DAR: a guia sai no site, pela chave da nota ("Recolhimento
 * prévio ICMS – Posto Fiscal") ou no DAR-1/AUT avulso. Imposto devido a outro
 * estado (DIFAL) sai na GNRE.
 */
export function ondeGerarGuia(tipo: string, uf: string, ufEmitente: string): { rotulo: string; url: string; passos: string } {
  if (tipo === "difal" || tipo === "fcp_difal" || uf !== ufEmitente) {
    return {
      rotulo: "Portal GNRE",
      url: "https://www.gnre.pe.gov.br",
      passos: `No Portal GNRE, escolha "Gerar GNRE", a UF favorecida ${uf}, a receita do ICMS consumidor final (e a do FCP, se houver), informe a chave da nota como documento de origem e o valor.`,
    };
  }
  if (uf === "MT") {
    return {
      rotulo: "SEFAZ-MT — Emissão de DAR-1/AUT",
      url: "https://www.sefaz.mt.gov.br/arrecadacao/darlivre/menudarlivre",
      passos:
        tipo === "icms_operacao"
          ? 'Na SEFAZ-MT, escolha "Recolhimento prévio ICMS – POSTO FISCAL" e digite a chave da nota (44 números): o DAR sai vinculado à NF-e, com o valor calculado pela SEFAZ.'
          : 'Na SEFAZ-MT, escolha "Pessoa Jurídica Inscrita" (ou "Pessoa Física" para o produtor), informe a inscrição estadual, o código de receita e o valor, e cite a chave da nota.',
    };
  }
  if (uf === "TO") {
    return {
      rotulo: "SEFAZ-TO — Emissão de DARE",
      url: "https://www.to.gov.br/sefaz",
      passos: "No site da SEFAZ-TO, emita o DARE com a inscrição estadual, o código de receita e o valor, citando a chave da nota.",
    };
  }
  return { rotulo: `SEFAZ-${uf}`, url: "https://www.nfe.fazenda.gov.br/portal/principal.aspx", passos: `Emita a guia de arrecadação no site da SEFAZ-${uf} com o código de receita e o valor, citando a chave da nota.` };
}

/** Rejeições mais comuns explicadas em palavras simples (o texto oficial aparece junto). */
export const EXPLICACAO_ERRO: Record<string, string> = {
  "202": "A assinatura do certificado digital não foi aceita. Fale com o escritório (certificado digital).",
  "203": "O emitente não está habilitado (credenciado) para emitir NF-e neste estado. É preciso pedir o credenciamento na SEFAZ.",
  "204": "Esta nota já foi enviada antes. O portal consulta a SEFAZ para trazer a autorização.",
  "207": "O CNPJ do emitente não confere. Fale com o escritório.",
  "209": "A inscrição estadual de quem emite não confere com o cadastro da SEFAZ. Confira a inscrição na configuração.",
  "213": "O CNPJ do certificado digital não é o da empresa que emite. Fale com o escritório.",
  "225": "Falha no formato do arquivo da nota. Fale com o escritório.",
  "228": "A data de emissão está muito antiga. Envie de novo.",
  "232": "Falta a inscrição estadual do comprador (contribuinte do ICMS). Corrija o cadastro do cliente.",
  "233": "A inscrição estadual do comprador não está cadastrada na SEFAZ. Confira o número com o cliente.",
  "234": "A inscrição estadual do comprador não pertence ao CNPJ informado. Confira o cadastro do cliente.",
  "245": "O CNPJ do emitente não está cadastrado na SEFAZ.",
  "301": "Uso denegado: irregularidade fiscal de quem emite. Fale com o escritório.",
  "302": "Uso denegado: irregularidade fiscal do comprador. Fale com o comprador.",
  "539": "Já existe uma nota com este número e outra chave. O escritório precisa conferir a numeração.",
  "656": "Muitas consultas seguidas: a SEFAZ pediu para esperar. O portal tenta de novo mais tarde.",
  "694": "Venda a não contribuinte de outro estado exige o DIFAL. Fale com o escritório (operação).",
  "696": "Venda a não contribuinte precisa ser marcada como consumidor final.",
  "703": "A data e a hora da emissão estão adiantadas. Envie de novo em alguns minutos.",
  "778": "O NCM do produto não existe. Corrija o cadastro do produto.",
  "806": "Operação com ICMS sem a alíquota correta. Fale com o escritório (operação).",
  "972": "Esta SEFAZ exige os dados do responsável técnico. Fale com o escritório.",
};

/** Certificado ainda válido agora. */
export function certificadoValido(validoAte: string | null | undefined): boolean {
  return validoAte ? new Date(validoAte).getTime() > Date.now() : false;
}
