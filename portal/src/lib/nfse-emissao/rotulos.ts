/** Textos da emissão de NFS-e nas telas. */

export type SituacaoNfse = "na_fila" | "enviando" | "autorizada" | "rejeitada" | "falha" | "cancelando" | "cancelada";

export const SITUACAO_NFSE: Record<SituacaoNfse, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo"; ajuda: string }> = {
  na_fila: { rotulo: "Emitindo", tom: "info", ajuda: "A nota está sendo enviada ao Emissor Nacional." },
  enviando: { rotulo: "Emitindo", tom: "info", ajuda: "A nota está sendo enviada ao Emissor Nacional." },
  autorizada: { rotulo: "Emitida", tom: "sucesso", ajuda: "Nota autorizada pelo Emissor Nacional." },
  rejeitada: { rotulo: "Não emitida", tom: "perigo", ajuda: "O Emissor Nacional recusou a nota. Veja o motivo e peça de novo com os dados corrigidos." },
  falha: { rotulo: "Sem resposta", tom: "alerta", ajuda: "O Emissor Nacional não respondeu. O portal tenta de novo sozinho; você também pode tentar agora." },
  cancelando: { rotulo: "Cancelando", tom: "info", ajuda: "O pedido de cancelamento está sendo enviado ao Emissor Nacional." },
  cancelada: { rotulo: "Cancelada", tom: "neutro", ajuda: "O cancelamento foi registrado no Emissor Nacional." },
};

export const EM_ANDAMENTO: SituacaoNfse[] = ["na_fila", "enviando", "cancelando"];

export const AMBIENTE_NFSE = {
  homologacao: { rotulo: "Teste (sem validade)", ajuda: "Ambiente de testes oficial (produção restrita): a nota não tem valor fiscal." },
  producao: { rotulo: "Produção (vale de verdade)", ajuda: "A nota tem valor fiscal e entra nas notas da empresa." },
} as const;

export const TOMADOR_TIPO = {
  cnpj: "Empresa (CNPJ)",
  cpf: "Pessoa física (CPF)",
  nao_identificado: "Consumidor não identificado",
} as const;

export const REGIME_APURACAO_SN = {
  1: "Tributos federais e ISS pelo Simples Nacional (DAS)",
  2: "Tributos federais pelo Simples e ISS fora do DAS",
  3: "Tributos federais e ISS fora do Simples",
} as const;

export const REGIME_ESPECIAL = {
  0: "Nenhum",
  1: "Ato cooperado (cooperativa)",
  2: "Estimativa",
  3: "Microempresa municipal",
  4: "Notário ou registrador",
  5: "Profissional autônomo",
  6: "Sociedade de profissionais",
  9: "Outros",
} as const;

export const MOTIVOS_CANCELAMENTO = {
  1: "Erro na emissão",
  2: "Serviço não prestado",
  9: "Outros",
} as const;

/** Códigos de rejeição mais comuns explicados em palavras simples (o texto oficial aparece junto). */
export const EXPLICACAO_ERRO: Record<string, string> = {
  E0006: "O ambiente (teste ou produção) não confere. Fale com o escritório.",
  E0008: "A data e a hora da emissão estão adiantadas em relação ao relógio do Emissor Nacional. Tente de novo em alguns minutos.",
  E0014: "Este número de nota já foi usado. O escritório precisa ajustar a numeração.",
  E0015: "A data da prestação não pode ser depois da emissão.",
  E0714: "A assinatura digital não foi aceita. Fale com o escritório (certificado digital).",
  E0718: "O certificado digital não é desta empresa. Fale com o escritório.",
  E1200: "O certificado digital não foi aceito na conexão. Fale com o escritório.",
  E1203: "O certificado digital venceu. Fale com o escritório.",
  E1270: "O município da empresa não emite pelo Emissor Nacional nessa data. Fale com o escritório.",
};

/** Certificado ainda válido agora (fora do componente: a tela é gerada no servidor a cada acesso). */
export function certificadoValido(validoAte: string | null | undefined): boolean {
  return validoAte ? new Date(validoAte).getTime() > Date.now() : false;
}
