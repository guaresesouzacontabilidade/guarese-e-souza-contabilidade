/** Textos da autorização registrada com o certificado (guardados junto com o cadastro). */
export const AUTORIZACAO_CLIENTE =
  "Autorizo o escritório GUARESE'S ON CONTABILIDADE a usar o certificado digital A1 da minha empresa, pelo Portal Guarese's ON, " +
  "para consultar e baixar as notas fiscais eletrônicas (NF-e e NFS-e) de interesse da empresa nos serviços oficiais da SEFAZ e do " +
  "Ambiente Nacional da NFS-e e, se eu ativar, registrar a ciência da emissão das NF-e recebidas. Posso revogar a qualquer momento.";

export const AUTORIZACAO_ESCRITORIO =
  "Declaro que o cliente autorizou por escrito o escritório a usar o certificado digital A1 da empresa para consultar e baixar as " +
  "notas fiscais eletrônicas (NF-e e NFS-e) de interesse da empresa nos serviços oficiais e, se ativado, registrar a ciência da " +
  "emissão das NF-e recebidas. O cliente é avisado deste cadastro e pode revogá-lo a qualquer momento.";

export const RESULTADO_EXECUCAO: Record<string, { rotulo: string; tom: "sucesso" | "neutro" | "alerta" | "perigo" }> = {
  novos: { rotulo: "Documentos novos", tom: "sucesso" },
  sem_novidades: { rotulo: "Sem novidades", tom: "neutro" },
  limite: { rotulo: "Aguardando a SEFAZ", tom: "alerta" },
  erro: { rotulo: "Erro", tom: "perigo" },
};

export const SERVICO_EXECUCAO: Record<string, string> = {
  nfe: "NF-e (SEFAZ)",
  nfse: "NFS-e (Ambiente Nacional)",
  ciencia: "Ciência da emissão",
  confirmacao: "Confirmação da operação",
};

export type SituacaoNotas = "desconectada" | "vencido" | "pausada" | "erro" | "ativa";

export const SITUACAO_NOTAS: Record<SituacaoNotas, { rotulo: string; tom: "neutro" | "perigo" | "alerta" | "sucesso" }> = {
  desconectada: { rotulo: "Desconectada", tom: "neutro" },
  vencido: { rotulo: "Certificado vencido", tom: "perigo" },
  pausada: { rotulo: "Pausada", tom: "alerta" },
  erro: { rotulo: "Com erro", tom: "perigo" },
  ativa: { rotulo: "Ativa", tom: "sucesso" },
};

export function situacaoNotas(
  certificado: { valido_ate: string } | null,
  config: { pausada: boolean; nfe_ativa: boolean; nfse_ativa: boolean; erros_seguidos: number } | null,
  agora = Date.now(),
): SituacaoNotas {
  if (!certificado) return "desconectada";
  if (new Date(certificado.valido_ate).getTime() <= agora) return "vencido";
  if (!config || config.pausada || (!config.nfe_ativa && !config.nfse_ativa)) return "pausada";
  if (config.erros_seguidos > 0) return "erro";
  return "ativa";
}
