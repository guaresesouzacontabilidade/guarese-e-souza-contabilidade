/** Rótulos da GTA (Guia de Trânsito Animal) usados nas telas e no robô. */
export const FAIXAS_GTA = ["0-12", "13-24", "25-36", "36+"] as const;
export type FaixaGta = (typeof FAIXAS_GTA)[number];

export const ROTULO_FAIXA: Record<FaixaGta, string> = {
  "0-12": "0 a 12 meses",
  "13-24": "13 a 24 meses",
  "25-36": "25 a 36 meses",
  "36+": "acima de 36 meses",
};

export const FINALIDADES_GTA: Record<string, string> = {
  abate: "Abate",
  engorda: "Engorda",
  recria: "Recria",
  reproducao: "Reprodução",
  cria: "Cria",
  exposicao: "Exposição ou feira",
  leilao: "Leilão",
  outra: "Outra",
};

export const ESPECIES_GTA: Record<string, string> = {
  bovina: "Bovinos",
  bubalina: "Bubalinos",
  equina: "Equinos",
  suina: "Suínos",
  ovina: "Ovinos",
  caprina: "Caprinos",
  aves: "Aves",
  outra: "Outra",
};

export const TRANSPORTES_GTA: Record<string, string> = {
  rodoviario: "Rodoviário (caminhão)",
  a_pe: "A pé (tocado)",
  ferroviario: "Ferroviário",
  fluvial: "Fluvial",
  outro: "Outro",
};

export const STATUS_GTA: Record<string, { rotulo: string; variante: "neutro" | "sucesso" | "perigo" | "info" }> = {
  rascunho: { rotulo: "Rascunho", variante: "neutro" },
  conferido: { rotulo: "Conferido no SIDAGO", variante: "sucesso" },
  erro: { rotulo: "Conferência com erro", variante: "perigo" },
  emitida: { rotulo: "GTA emitida", variante: "info" },
};

export const SITUACAO_ACESSO_SIDAGO: Record<string, { rotulo: string; variante: "neutro" | "sucesso" | "perigo" }> = {
  nao_testado: { rotulo: "Ainda não testado", variante: "neutro" },
  conectado: { rotulo: "Entrou no SIDAGO", variante: "sucesso" },
  erro: { rotulo: "Erro no último acesso", variante: "perigo" },
};
