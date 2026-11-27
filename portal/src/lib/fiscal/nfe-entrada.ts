/**
 * NF-e de entrada de uma ou mais empresas: junta os resumos entregues pela
 * SEFAZ (busca automática; o XML completo só vem depois da ciência da emissão)
 * com as notas cujo XML completo está no portal (buscado ou enviado em
 * Documentos), sem repetir a mesma chave.
 */

export interface ResumoEntrada {
  empresa_id: string;
  chave: string;
  emitente_documento: string | null;
  emitente_nome: string | null;
  emitente_ie: string | null;
  data_emissao: string | null;
  /** Do ponto de vista da empresa: "saida" quando quem emitiu fez uma nota de entrada (tpNF 0). */
  tipo_operacao: string | null;
  valor: number | string | null;
  situacao: string;
  ciencia_em: string | null;
  ciencia_retorno: string | null;
  documento_id: string | null;
  confirmacao_pedida_em?: string | null;
  confirmacao_em?: string | null;
  confirmacao_retorno?: string | null;
}

export interface FiscalEntrada {
  empresa_id: string;
  documento_id: string;
  chave_acesso: string | null;
  numero: string | null;
  serie: string | null;
  data_emissao: string | null;
  emitente_documento: string | null;
  emitente_nome: string | null;
  emitente_uf: string | null;
  emitente_ie: string | null;
  destinatario_documento: string | null;
  destinatario_nome: string | null;
  destinatario_uf: string | null;
  tp_nf: string | null;
  valor_total: number | string | null;
  cancelada_evento: boolean | null;
  situacao_arquivo: string | null;
  natureza_operacao: string | null;
  cfops: string[] | null;
}

export type SituacaoEntrada = "Autorizada" | "Cancelada" | "Denegada" | "Não autorizada";

/**
 * "fornecedor": nota emitida por terceiro para a empresa (o caso comum);
 * "entrada_do_emitente": quem emitiu fez uma nota de entrada (ex.: devolução, compra de produtor);
 * "propria": nota de entrada emitida pela própria empresa (ex.: importação, compra de produtor rural).
 */
export type TipoEntrada = "fornecedor" | "entrada_do_emitente" | "propria";

export interface LinhaEntrada {
  empresaId: string;
  chave: string | null;
  numero: string | null;
  serie: string | null;
  emissao: string | null;
  /** A outra parte da nota: quem emitiu ou, na nota emitida pela própria empresa, o destinatário. */
  fornecedor: string | null;
  fornecedorDocumento: string | null;
  fornecedorIe: string | null;
  fornecedorUf: string | null;
  valor: number | null;
  situacao: SituacaoEntrada;
  tipo: TipoEntrada;
  xmlCompleto: boolean;
  /** "registrada" | "recusada" | "pendente" | null (nota sem resumo da SEFAZ: veio em Documentos). */
  ciencia: "registrada" | "recusada" | "pendente" | null;
  cienciaDetalhe: string | null;
  /** Confirmação da operação pedida por uma pessoa: "pedida" | "registrada" | "recusada" | null (não pedida). */
  confirmacao: "pedida" | "registrada" | "recusada" | null;
  confirmacaoDetalhe: string | null;
  natureza: string | null;
  cfops: string | null;
}

/** Número e série da nota a partir da chave de acesso (44 dígitos). */
export function numeroDaChave(chave: string | null | undefined): { numero: string | null; serie: string | null } {
  if (!chave || !/^\d{44}$/.test(chave)) return { numero: null, serie: null };
  return { numero: String(Number(chave.slice(25, 34))), serie: String(Number(chave.slice(22, 25))) };
}

const numero = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const limpo = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Mesmo CNPJ (ou outro estabelecimento da mesma empresa, pela raiz) ou mesmo CPF. */
function mesmaEmpresa(a: string | null | undefined, b: string | null | undefined) {
  const x = limpo(a);
  const y = limpo(b);
  if (!x || !y) return false;
  return x.length === 14 && y.length === 14 ? x.slice(0, 8) === y.slice(0, 8) : x === y;
}

function situacaoDoResumo(s: string): SituacaoEntrada {
  return s === "cancelada" ? "Cancelada" : s === "denegada" ? "Denegada" : "Autorizada";
}

function ciencia(r: ResumoEntrada): Pick<LinhaEntrada, "ciencia" | "cienciaDetalhe" | "confirmacao" | "confirmacaoDetalhe"> {
  const confirmacao: Pick<LinhaEntrada, "confirmacao" | "confirmacaoDetalhe"> = r.confirmacao_em
    ? { confirmacao: "registrada", confirmacaoDetalhe: r.confirmacao_em }
    : r.confirmacao_pedida_em
      ? r.confirmacao_retorno
        ? { confirmacao: "recusada", confirmacaoDetalhe: r.confirmacao_retorno }
        : { confirmacao: "pedida", confirmacaoDetalhe: r.confirmacao_pedida_em }
      : { confirmacao: null, confirmacaoDetalhe: null };
  if (r.ciencia_em) return { ciencia: "registrada", cienciaDetalhe: r.ciencia_em, ...confirmacao };
  if (r.ciencia_retorno) return { ciencia: "recusada", cienciaDetalhe: r.ciencia_retorno, ...confirmacao };
  return { ciencia: "pendente", cienciaDetalhe: null, ...confirmacao };
}

/**
 * Uma linha por nota (empresa + chave). `documentos` (empresa → CNPJ/CPF)
 * identifica as notas de entrada emitidas pela própria empresa.
 */
export function mesclarEntradas(resumos: ResumoEntrada[], fiscais: FiscalEntrada[], documentos?: Map<string, string | null>): LinhaEntrada[] {
  const linhas = new Map<string, LinhaEntrada>();
  for (const f of fiscais) {
    const chave = f.chave_acesso && /^\d{44}$/.test(f.chave_acesso) ? f.chave_acesso : null;
    const pelaChave = numeroDaChave(chave);
    const propria = f.tp_nf === "0" && mesmaEmpresa(f.emitente_documento, documentos?.get(f.empresa_id));
    linhas.set(`${f.empresa_id}|${chave ?? `doc:${f.documento_id}`}`, {
      empresaId: f.empresa_id,
      chave,
      numero: f.numero ?? pelaChave.numero,
      serie: f.serie ?? pelaChave.serie,
      emissao: f.data_emissao,
      fornecedor: propria ? f.destinatario_nome : f.emitente_nome,
      fornecedorDocumento: propria ? f.destinatario_documento : f.emitente_documento,
      fornecedorIe: propria ? null : f.emitente_ie,
      fornecedorUf: propria ? f.destinatario_uf : f.emitente_uf,
      valor: numero(f.valor_total),
      situacao: f.cancelada_evento ? "Cancelada" : f.situacao_arquivo === "protocolo_nao_autorizado_no_arquivo" ? "Não autorizada" : "Autorizada",
      tipo: propria ? "propria" : f.tp_nf === "0" ? "entrada_do_emitente" : "fornecedor",
      xmlCompleto: true,
      ciencia: null,
      cienciaDetalhe: null,
      confirmacao: null,
      confirmacaoDetalhe: null,
      natureza: f.natureza_operacao,
      cfops: f.cfops?.length ? f.cfops.join(", ") : null,
    });
  }
  for (const r of resumos) {
    const chaveMapa = `${r.empresa_id}|${r.chave}`;
    const existente = linhas.get(chaveMapa);
    if (existente) {
      // XML completo já no portal: o resumo só acrescenta a ciência e o cancelamento
      Object.assign(existente, ciencia(r));
      if (r.situacao === "cancelada") existente.situacao = "Cancelada";
      if (existente.tipo !== "propria") existente.fornecedorIe ??= r.emitente_ie;
      continue;
    }
    const pelaChave = numeroDaChave(r.chave);
    linhas.set(chaveMapa, {
      empresaId: r.empresa_id,
      chave: r.chave,
      numero: pelaChave.numero,
      serie: pelaChave.serie,
      emissao: r.data_emissao,
      fornecedor: r.emitente_nome,
      fornecedorDocumento: r.emitente_documento,
      fornecedorIe: r.emitente_ie,
      fornecedorUf: null,
      valor: numero(r.valor),
      situacao: situacaoDoResumo(r.situacao),
      tipo: r.tipo_operacao === "saida" ? "entrada_do_emitente" : "fornecedor",
      // XML no portal, mas fora da lista de entradas acima (outro mês de competência ou outra classificação)
      xmlCompleto: Boolean(r.documento_id),
      ...ciencia(r),
      natureza: null,
      cfops: null,
    });
  }
  return [...linhas.values()].sort(
    (a, b) =>
      a.empresaId.localeCompare(b.empresaId) ||
      (a.emissao ?? "").localeCompare(b.emissao ?? "") ||
      (a.numero ?? "").localeCompare(b.numero ?? "", "pt-BR", { numeric: true }),
  );
}

export const ROTULO_TIPO_ENTRADA: Record<TipoEntrada, string> = {
  fornecedor: "Entrada",
  entrada_do_emitente: "Nota de entrada do emitente (ex.: devolução)",
  propria: "Entrada emitida pela própria empresa",
};

/** Totais por empresa (para a aba de resumo da planilha). */
export function totaisPorEmpresa(linhas: LinhaEntrada[]) {
  const t = new Map<string, { notas: number; valor: number; comXml: number; soResumo: number; canceladas: number }>();
  for (const l of linhas) {
    const x = t.get(l.empresaId) ?? { notas: 0, valor: 0, comXml: 0, soResumo: 0, canceladas: 0 };
    x.notas++;
    if (l.situacao === "Autorizada") x.valor = Math.round((x.valor + (l.valor ?? 0)) * 100) / 100;
    else x.canceladas++;
    if (l.xmlCompleto) x.comXml++;
    else x.soResumo++;
    t.set(l.empresaId, x);
  }
  return t;
}
