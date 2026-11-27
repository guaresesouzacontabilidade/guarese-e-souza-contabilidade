import { palavras } from "./lista-servicos";

/**
 * Dados da reforma tributária (IBS/CBS) do serviço, no leiaute da NT 009:
 * código NBS, indicador da operação (cIndOp) e classificação tributária
 * (cClassTrib), escolhidos na tabela oficial de correlação (Anexo VIII), e a
 * atividade do Simples Nacional (cAtvSN).
 */

export interface OpcaoReforma {
  nbs: string;
  descricao_nbs: string;
  cind_op: string;
  cclass_trib: string;
  nome_cclass_trib: string;
}

/** "126019000" → "1.2601.90.00" */
export function formatarNbs(nbs: string) {
  return /^\d{9}$/.test(nbs) ? `${nbs[0]}.${nbs.slice(1, 5)}.${nbs.slice(5, 7)}.${nbs.slice(7)}` : nbs;
}

/** Itens da tabela de correlação de um código de tributação: o subitem (14.10) e, no item 99, o código completo. */
export function itensCorrelacao(codigo: string): string[] {
  return [`${codigo.slice(0, 2)}.${codigo.slice(2, 4)}`, `${codigo.slice(0, 2)}.${codigo.slice(2, 4)}.${codigo.slice(4, 6)}`];
}

/** Opção padrão de um NBS: operação no estabelecimento do prestador ou com adquirente no País (final 01) e tributação integral. */
export function classificacaoPadrao(opcoes: OpcaoReforma[], nbs: string): OpcaoReforma | null {
  const doNbs = opcoes.filter((o) => o.nbs === nbs);
  return (
    [...doNbs].sort(
      (a, b) =>
        Number(b.cind_op.endsWith("01")) - Number(a.cind_op.endsWith("01")) ||
        Number(b.cclass_trib === "000001") - Number(a.cclass_trib === "000001") ||
        a.cind_op.localeCompare(b.cind_op) ||
        a.cclass_trib.localeCompare(b.cclass_trib),
    )[0] ?? null
  );
}

/** NBS cuja descrição mais se parece com o nome do serviço (sugestão; o escritório confere). */
export function nbsMaisParecido(opcoes: OpcaoReforma[], texto: string): string | null {
  const nbs = [...new Map(opcoes.map((o) => [o.nbs, o.descricao_nbs])).entries()];
  if (!nbs.length) return null;
  if (nbs.length === 1) return nbs[0][0];
  const consulta = palavras(texto);
  let melhor: [string, number] = [nbs[0][0], 0];
  for (const [codigo, descricao] of nbs) {
    const termos = palavras(descricao);
    const nota = consulta.filter((q) => termos.some((t) => t.slice(0, 5) === q.slice(0, 5))).length;
    if (nota > melhor[1]) melhor = [codigo, nota];
  }
  return melhor[0];
}

export const ATIVIDADES_SIMPLES: Record<number, string> = {
  7: "07 - Serviços do Anexo III (ISS)",
  8: "08 - Serviços contábeis com ISS fixo (Anexo III)",
  9: "09 - Serviços sujeitos ao Fator R (Anexo III ou V)",
  10: "10 - Transporte municipal de passageiros (16.01, Anexo III)",
  11: "11 - Locação de bens móveis e operações sem ISS (Anexo III)",
  12: "12 - Construção civil 7.02 e 7.05 (Anexo III)",
  13: "13 - Construção civil 7.02 e 7.05 (Anexo IV)",
  14: "14 - Serviços do Anexo IV",
  90: "90 - Operações não tributadas",
};

/** Atividades do Simples que combinam com o serviço (a NT 009 liga 10, 11, 12 e 13 a serviços específicos). */
export function atividadesSimplesDoServico(codigo: string): number[] {
  const sub = codigo.slice(0, 4);
  if (sub === "1601") return [10];
  if (codigo === "990401") return [11];
  if (sub === "0702" || sub === "0705") return [12, 13];
  return [7, 8, 9, 14, 90];
}

/** Atividade do Simples pelo serviço e pelo anexo da empresa (Cálculos → Configuração), quando o serviço não define. */
export function atividadeSimplesPadrao(codigo: string, anexo: string | null | undefined, fatorR: boolean | null | undefined): number {
  const sub = codigo.slice(0, 4);
  if (sub === "1601") return 10;
  if (codigo === "990401") return 11;
  if (sub === "0702" || sub === "0705") return anexo === "IV" ? 13 : 12;
  if (anexo === "IV") return 14;
  if (anexo === "V" || fatorR) return 9;
  return 7;
}
