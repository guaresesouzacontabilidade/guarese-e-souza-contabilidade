/** Tipos de vencimento acompanhados (espelha app.tipos_vencimento()). */
export const TIPOS_VENCIMENTO: Record<string, { rotulo: string; ajuda?: string }> = {
  certificado_digital: { rotulo: "Certificado digital (e-CNPJ / e-CPF)", ajuda: "A1 vale 1 ano; A3, de 1 a 3 anos." },
  alvara_funcionamento: { rotulo: "Alvará de funcionamento" },
  licenca_sanitaria: { rotulo: "Licença sanitária (Vigilância Sanitária)" },
  licenca_bombeiros: { rotulo: "Vistoria do Corpo de Bombeiros" },
  licenca_ambiental: { rotulo: "Licença ambiental" },
  cnd_federal: { rotulo: "CND Federal (Receita Federal e PGFN)", ajuda: "Em geral, válida por 180 dias." },
  cnd_estadual: { rotulo: "Certidão negativa estadual (SEFAZ)" },
  cnd_municipal: { rotulo: "Certidão negativa municipal" },
  crf_fgts: { rotulo: "Certificado de Regularidade do FGTS (CRF)", ajuda: "Em geral, válido por 30 dias." },
  cndt: { rotulo: "Certidão Negativa de Débitos Trabalhistas (CNDT)", ajuda: "Em geral, válida por 180 dias." },
  procuracao: { rotulo: "Procuração" },
  contrato: { rotulo: "Contrato (aluguel, prestação de serviço etc.)" },
  outro: { rotulo: "Outro" },
};

export type SituacaoVencimento = "vencido" | "vence_hoje" | "proximo" | "atencao" | "em_dia";

/** Dias até a validade (negativo: vencido). Datas AAAA-MM-DD. */
export function diasAte(validade: string, hoje: string): number {
  return Math.round((new Date(`${validade}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 86400000);
}

export function situacaoVencimento(validade: string, hoje: string): { situacao: SituacaoVencimento; rotulo: string; tom: "perigo" | "alerta" | "info" | "sucesso" } {
  const d = diasAte(validade, hoje);
  if (d < 0) return { situacao: "vencido", rotulo: `Vencido há ${-d} ${d === -1 ? "dia" : "dias"}`, tom: "perigo" };
  if (d === 0) return { situacao: "vence_hoje", rotulo: "Vence hoje", tom: "perigo" };
  if (d <= 15) return { situacao: "proximo", rotulo: `Vence em ${d} ${d === 1 ? "dia" : "dias"}`, tom: "alerta" };
  if (d <= 30) return { situacao: "atencao", rotulo: `Vence em ${d} dias`, tom: "info" };
  return { situacao: "em_dia", rotulo: "Em dia", tom: "sucesso" };
}
