/** Textos da emissão de CT-e nas telas e no DACTE. */

import type { SituacaoNfe } from "@/lib/nfe-emissao/rotulos";

export type SituacaoCte = SituacaoNfe;

type Tom = "neutro" | "info" | "sucesso" | "alerta" | "perigo";

export const SITUACAO_CTE: Record<SituacaoCte, { rotulo: string; tom: Tom; ajuda: string }> = {
  na_fila: { rotulo: "Emitindo", tom: "info", ajuda: "O CT-e está sendo enviado à SEFAZ." },
  enviando: { rotulo: "Emitindo", tom: "info", ajuda: "O CT-e está sendo enviado à SEFAZ." },
  aguardando: { rotulo: "Na SEFAZ", tom: "info", ajuda: "A SEFAZ recebeu o CT-e e ainda está processando. O portal consulta de novo sozinho." },
  autorizada: { rotulo: "Autorizado", tom: "sucesso", ajuda: "CT-e autorizado pela SEFAZ: vale como documento fiscal." },
  rejeitada: { rotulo: "Rejeitado", tom: "perigo", ajuda: "A SEFAZ recusou o CT-e. Veja o motivo, corrija e envie de novo (o número é o mesmo)." },
  denegada: { rotulo: "Denegado", tom: "perigo", ajuda: "A SEFAZ denegou o uso do CT-e por irregularidade cadastral. O número fica usado. Fale com o escritório." },
  falha: { rotulo: "Sem resposta", tom: "alerta", ajuda: "A SEFAZ não respondeu. O portal tenta de novo sozinho (consultando antes, para não emitir duas vezes)." },
  cancelando: { rotulo: "Cancelando", tom: "info", ajuda: "O pedido de cancelamento está sendo enviado à SEFAZ." },
  cancelada: { rotulo: "Cancelado", tom: "neutro", ajuda: "O cancelamento foi registrado na SEFAZ." },
  descartada: { rotulo: "Descartado", tom: "neutro", ajuda: "CT-e rejeitado que não será corrigido. O número precisa ser inutilizado na SEFAZ." },
};

export const EM_ANDAMENTO_CTE: SituacaoCte[] = ["na_fila", "enviando", "aguardando", "cancelando"];

export const AMBIENTE_CTE = {
  homologacao: { rotulo: "Teste — homologação (sem valor fiscal)", ajuda: "Ambiente de testes da SEFAZ: o CT-e não tem valor fiscal." },
  producao: { rotulo: "Produção (vale de verdade)", ajuda: "O CT-e tem valor fiscal e entra nos documentos da empresa." },
} as const;

/** Quem paga o frete (tomador do serviço). */
export const TOMADOR_CTE = {
  remetente: "Remetente (quem envia a carga — frete CIF)",
  destinatario: "Destinatário (quem recebe a carga — frete FOB)",
  outro: "Outra empresa ou pessoa",
} as const;

/** Papel do tomador no leiaute (toma) para o DACTE. */
export const PAPEL_TOMADOR: Record<string, string> = { "0": "Remetente", "1": "Expedidor", "2": "Recebedor", "3": "Destinatário", "4": "Outros" };

export const CST_ICMS_CTE: Record<string, string> = {
  "00": "00 - Tributação normal",
  "20": "20 - Com redução da base de cálculo",
  "40": "40 - Isenta",
  "41": "41 - Não tributada",
  "51": "51 - Diferida",
  "60": "60 - ICMS cobrado por substituição tributária (pago pelo tomador)",
  "90": "90 - Outros",
  sn: "Simples Nacional (ICMS no DAS)",
};

/** CFOP da prestação de serviço de transporte (5 dentro do estado; 6 para outro estado). */
export const CFOP_FRETE: Record<string, string> = {
  "351": "Para execução de serviço da mesma natureza (subcontratação)",
  "352": "A estabelecimento industrial",
  "353": "A estabelecimento comercial",
  "354": "A prestador de serviço de comunicação",
  "355": "A geradora ou distribuidora de energia elétrica",
  "356": "A produtor rural",
  "357": "A não contribuinte",
  "359": "A contribuinte ou não contribuinte, com mercadoria dispensada de nota fiscal",
  "360": "A contribuinte substituto em relação ao serviço de transporte",
};

export const DESTINO_CTE = { interna: "Dentro do estado (CFOP 5.3xx)", interestadual: "Para outro estado (CFOP 6.3xx)" } as const;

/**
 * Campos que a carta de correção do CT-e pode corrigir pelo portal (grupo e
 * campo do leiaute). Valores, impostos, datas, tomador, remetente e
 * destinatário não se corrigem por carta (Convênio SINIEF 06/89, art. 58-B).
 */
export const CAMPOS_CCE_CTE = [
  { grupo: "compl", campo: "xObs", rotulo: "Observações", max: 500 },
  { grupo: "infCarga", campo: "proPred", rotulo: "Produto predominante", max: 60 },
  { grupo: "infCarga", campo: "xOutCat", rotulo: "Outras características da carga", max: 30 },
  { grupo: "infCarga", campo: "vCarga", rotulo: "Valor total da carga (ex.: 34500.00)", max: 16 },
  { grupo: "rodo", campo: "RNTRC", rotulo: "RNTRC da transportadora (8 dígitos)", max: 8 },
] as const;
