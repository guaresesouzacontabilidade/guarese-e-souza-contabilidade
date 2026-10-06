/**
 * Situação de uma NF-e recebida só em resumo (sem o XML completo no portal),
 * pela manifestação do destinatário:
 *  - ciência da emissão (automática): a SEFAZ aceita até 10 dias depois da emissão;
 *  - confirmação da operação (pedida por uma pessoa): aceita até 180 dias.
 * Puro (sem banco), para as telas, a planilha e os testes.
 */

export const PRAZO_CIENCIA_DIAS = 10;
export const PRAZO_CONFIRMACAO_DIAS = 180;

export interface ResumoSemXml {
  data_emissao: string | null;
  ciencia_em: string | null;
  ciencia_retorno: string | null;
  confirmacao_pedida_em: string | null;
  confirmacao_em: string | null;
  confirmacao_retorno: string | null;
}

export type EstadoSemXml =
  | "aguardando_ciencia"
  | "ciencia_registrada"
  | "ciencia_recusada"
  | "confirmacao_pedida"
  | "confirmada"
  | "confirmacao_recusada";

export function estadoSemXml(r: ResumoSemXml): EstadoSemXml {
  if (r.confirmacao_em) return "confirmada";
  if (r.confirmacao_pedida_em) return r.confirmacao_retorno ? "confirmacao_recusada" : "confirmacao_pedida";
  if (r.ciencia_em) return "ciencia_registrada";
  if (r.ciencia_retorno) return "ciencia_recusada";
  return "aguardando_ciencia";
}

/** Dias desde a emissão (data local), ou null sem data. */
export function diasDesdeEmissao(dataEmissao: string | null, hojeIso: string): number | null {
  if (!dataEmissao) return null;
  const emissao = Date.parse(`${dataEmissao.slice(0, 10)}T00:00:00Z`);
  const hoje = Date.parse(`${hojeIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((hoje - emissao) / 86_400_000);
}

/**
 * A confirmação da operação faz sentido quando a ciência não resolve mais
 * (recusada pela SEFAZ) ou quando um pedido anterior foi recusado, e ainda
 * dentro dos 180 dias da emissão.
 */
export function podeConfirmar(r: ResumoSemXml, hojeIso: string): boolean {
  const estado = estadoSemXml(r);
  if (estado !== "ciencia_recusada" && estado !== "confirmacao_recusada") return false;
  const dias = diasDesdeEmissao(r.data_emissao, hojeIso);
  return dias !== null && dias <= PRAZO_CONFIRMACAO_DIAS;
}

/** Contagem por situação (para os avisos das telas). */
export function contarSemXml(resumos: ResumoSemXml[], hojeIso: string) {
  const t = {
    total: resumos.length,
    aguardandoCiencia: 0,
    aCaminho: 0,
    confirmacaoPedida: 0,
    recusadas: 0,
    confirmaveis: 0,
  };
  for (const r of resumos) {
    const e = estadoSemXml(r);
    if (e === "aguardando_ciencia") t.aguardandoCiencia++;
    else if (e === "ciencia_registrada" || e === "confirmada") t.aCaminho++;
    else if (e === "confirmacao_pedida") t.confirmacaoPedida++;
    else t.recusadas++;
    if (podeConfirmar(r, hojeIso)) t.confirmaveis++;
  }
  return t;
}
