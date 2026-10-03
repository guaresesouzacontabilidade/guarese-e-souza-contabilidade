/**
 * ICMS por estado: regras nacionais das alíquotas interestaduais e rótulos da
 * tabela de referência (public.icms_uf).
 *
 * Alíquotas interestaduais (iguais em todo o país):
 *   - Resolução do Senado nº 22/1989: 7% nas saídas do Sul e do Sudeste (exceto
 *     Espírito Santo) para o Norte, o Nordeste, o Centro-Oeste e o Espírito
 *     Santo; 12% nas demais operações entre estados;
 *   - Resolução do Senado nº 13/2012: 4% para mercadoria importada (ou com
 *     conteúdo de importação acima de 40%) — origem 1, 2, 3 ou 8 na nota;
 *   - Resolução do Senado nº 95/1996: 4% no transporte aéreo interestadual.
 */

export const REGIOES = { N: "Norte", NE: "Nordeste", CO: "Centro-Oeste", SE: "Sudeste", S: "Sul" } as const;
export type Regiao = keyof typeof REGIOES;

/** Estados do Sul e do Sudeste, exceto o Espírito Santo (origem dos 7%). */
export const SUL_SUDESTE_EXCETO_ES = new Set(["MG", "PR", "RJ", "RS", "SC", "SP"]);

/** Origens da mercadoria (tabela A do CST) que levam à alíquota de 4%. */
export const ORIGENS_IMPORTADAS = new Set(["1", "2", "3", "8"]);

/** Alíquota interestadual entre dois estados; `null` quando a operação é interna. */
export function aliquotaInterestadual(origem: string, destino: string, importado = false): number | null {
  const o = origem.trim().toUpperCase();
  const d = destino.trim().toUpperCase();
  if (!o || !d || o === d) return null;
  if (importado) return 4;
  return SUL_SUDESTE_EXCETO_ES.has(o) && !SUL_SUDESTE_EXCETO_ES.has(d) ? 7 : 12;
}

/** Diferença entre a alíquota interna do destino (com FCP) e a interestadual, em pontos. */
export function diferencialAliquotas(internaDestino: number, fcpDestino: number | null, interestadual: number): number {
  return Math.max(0, Math.round((internaDestino + (fcpDestino ?? 0) - interestadual) * 100) / 100);
}

export function textoAliquota(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${String(Math.round(v * 100) / 100).replace(".", ",")}%`;
}

export type SituacaoAliquota = "conferida" | "informada" | "a_conferir";
export type SituacaoVencimento = "conferido" | "calendario" | "a_conferir";
export type AjustePrazo = "antecipar" | "postergar" | "manter";

export const SITUACAO_ALIQUOTA: Record<SituacaoAliquota, { rotulo: string; variante: "sucesso" | "info" | "alerta"; ajuda: string }> = {
  conferida: { rotulo: "Conferida na lei", variante: "sucesso", ajuda: "Lida no texto oficial da norma." },
  informada: { rotulo: "Informada pelo estado", variante: "info", ajuda: "Informação oficial do estado (tabela da Fazenda, Portal Nacional do DIFAL ou Assembleia), sem leitura do texto da norma." },
  a_conferir: { rotulo: "A conferir", variante: "alerta", ajuda: "Só há informação antiga ou indireta: confira na legislação do estado." },
};

export const SITUACAO_VENCIMENTO: Record<SituacaoVencimento, { rotulo: string; variante: "sucesso" | "info" | "alerta"; ajuda: string }> = {
  conferido: { rotulo: "Conferido", variante: "sucesso", ajuda: "Lido no regulamento ou ato oficial do estado." },
  calendario: { rotulo: "Calendário do estado", variante: "info", ajuda: "O estado fixa as datas periodicamente: cadastre as datas de cada calendário." },
  a_conferir: { rotulo: "A conferir", variante: "alerta", ajuda: "Ainda não conferido: confira no regulamento do estado e cadastre." },
};

export const AJUSTES_PRAZO: Record<AjustePrazo, string> = {
  postergar: "passa para o dia útil seguinte",
  antecipar: "antecipa para o dia útil anterior",
  manter: "mantém a data",
};

export function textoVencimento(v: { vencimento_situacao: string; vencimento_dia: number | null; vencimento_ajuste: string | null }): string {
  if (v.vencimento_situacao === "calendario") return "Datas do calendário fiscal do estado";
  if (v.vencimento_situacao !== "conferido" || !v.vencimento_dia) return "A conferir";
  const ajuste = AJUSTES_PRAZO[(v.vencimento_ajuste ?? "postergar") as AjustePrazo] ?? AJUSTES_PRAZO.postergar;
  return `Dia ${v.vencimento_dia} do mês seguinte (sem expediente, ${ajuste})`;
}
