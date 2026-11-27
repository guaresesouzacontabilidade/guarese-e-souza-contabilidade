import "server-only";
import { Decimal, lerValorBR } from "@/lib/dinheiro";
import { trechosDoPdf, type Trecho } from "@/lib/gestao/danfe-pdf";

/**
 * Leitura do relatório de contas a pagar/receber em PDF (o relatório que o
 * sistema antigo da empresa imprime: uma tabela com descrição, vencimento,
 * situação e valor). O PDF não tem colunas de verdade: o portal lê o texto com
 * a posição de cada trecho, acha a linha do cabeçalho da tabela, encaixa cada
 * trecho na coluna mais próxima e devolve as linhas como se fosse uma planilha
 * (o resto da importação é o mesmo das planilhas).
 *
 * Conferência: a soma das linhas tem de bater com o total do resumo do
 * relatório e a quantidade com o número de cobranças informado. Tudo é lido no
 * servidor do portal: nada vai para serviços de fora.
 */
export interface RelatorioContasPdf {
  /** Pelo título: "contas a pagar" ou "contas a receber". */
  tipo: "pagar" | "receber" | null;
  /** Cabeçalho + linhas da tabela, como uma planilha. */
  linhas: string[][];
  /** O que o resumo do relatório informa. */
  resumo: { total: string | null; quantidade: number | null };
  conferencia: { soma: string; quantidade: number; confere: boolean | null; problemas: string[] };
}

export class RelatorioIlegivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RelatorioIlegivel";
  }
}

const DATA = /^\d{2}\/\d{2}\/\d{2,4}$/;
const DINHEIRO = /^-?R?\$?\s*-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;

/** Rótulos de cabeçalho que reconhecem a tabela de contas. */
const ROTULOS = [/descri|hist[oó]rico|refer[eê]ncia/i, /venc/i, /^valor/i, /situa|status/i, /destinad|fornecedor|favorecido|cliente|benefici|nome|raz[aã]o/i, /^cpf|^cnpj/i, /emiss|compet/i, /documento|n[º°o]\.?\s*(doc|t[ií]tulo)|parcela/i];

interface Linha {
  pagina: number;
  y: number;
  trechos: Trecho[];
}

function montarLinhas(trechos: Trecho[]): Linha[] {
  const ordenados = [...trechos].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  const linhas: Linha[] = [];
  for (const t of ordenados) {
    const atual = linhas.at(-1);
    if (atual && atual.pagina === t.pagina && Math.abs(atual.y - t.y) <= 2) atual.trechos.push(t);
    else linhas.push({ pagina: t.pagina, y: t.y, trechos: [t] });
  }
  for (const l of linhas) l.trechos.sort((a, b) => a.x - b.x);
  return linhas;
}

const centro = (t: Trecho) => t.x + t.largura / 2;
const textoDa = (l: Linha) => l.trechos.map((t) => t.texto).join(" ");

/** Linha que parece o cabeçalho da tabela (pelo menos 3 rótulos conhecidos, um deles o valor). */
function ehCabecalho(l: Linha) {
  const acertos = l.trechos.filter((t) => ROTULOS.some((r) => r.test(t.texto.trim()))).length;
  return acertos >= 3 && l.trechos.some((t) => /^valor/i.test(t.texto.trim()));
}

function valorBR(texto: string): Decimal | null {
  return lerValorBR(texto.replace(/R\$\s*/i, "").trim());
}

/** Lê o relatório a partir dos trechos de texto com posição (separado para testar). */
export function lerRelatorioContasTrechos(trechos: Trecho[]): RelatorioContasPdf {
  if (!trechos.length) throw new RelatorioIlegivel("Este PDF não tem texto para ler (parece foto ou digitalização). Envie o relatório gerado pelo sistema, ou em Excel/CSV.");
  const linhas = montarLinhas(trechos);
  const iCab = linhas.findIndex(ehCabecalho);
  if (iCab < 0) {
    throw new RelatorioIlegivel("Não achamos a tabela de contas neste PDF (cabeçalho com descrição, vencimento e valor). Envie o relatório de contas a pagar/receber, ou a planilha em Excel/CSV.");
  }
  const cab = linhas[iCab];
  const colunas = cab.trechos.map((t) => ({ rotulo: t.texto.trim(), centro: centro(t) }));
  // Fronteiras entre as colunas: no meio do caminho entre os centros dos rótulos
  const limites = colunas.slice(1).map((c, i) => (colunas[i].centro + c.centro) / 2);
  const colunaDe = (t: Trecho) => {
    const c = centro(t);
    let i = 0;
    while (i < limites.length && c > limites[i]) i++;
    return i;
  };
  const rotulosCab = new Set(colunas.map((c) => c.rotulo.toLowerCase()));

  // Antes do cabeçalho (na primeira página): título e resumo
  const antes = linhas.slice(0, iCab).filter((l) => l.pagina === cab.pagina);
  const textoAntes = antes.map(textoDa).join(" \n ");
  const tipo = /contas?\s+a\s+pagar|pagamentos?\s+a\s+fazer/i.test(textoAntes) ? "pagar" : /contas?\s+a\s+receber|recebimentos?\s+a\s+receber/i.test(textoAntes) ? "receber" : null;
  const mQtd = /(\d{1,5})\s+(cobran[cç]as?|lan[cç]amentos?|t[ií]tulos?|contas?|parcelas?|registros?)\b/i.exec(textoAntes);
  let total: string | null = null;
  const trechosAntes = antes.flatMap((l) => l.trechos);
  const rotuloTotal = trechosAntes.find((t) => /^(valor\s+)?total(\s+geral)?$/i.test(t.texto.trim()));
  if (rotuloTotal) {
    const candidato = trechosAntes
      .filter((t) => DINHEIRO.test(t.texto.trim()) && t.y < rotuloTotal.y && rotuloTotal.y - t.y <= 45 && Math.abs(centro(t) - centro(rotuloTotal)) <= 90)
      .sort((a, b) => b.y - a.y)[0];
    const v = candidato ? valorBR(candidato.texto) : null;
    if (v) total = v.toFixed(2);
  }

  // Linhas da tabela: depois do cabeçalho (o cabeçalho se repete nas outras páginas)
  const dados: { pagina: number; y: number; celulas: string[] }[] = [];
  const paginaComCabecalho = new Map<number, number>();
  for (const l of linhas.slice(iCab)) if (ehCabecalho(l) && !paginaComCabecalho.has(l.pagina)) paginaComCabecalho.set(l.pagina, l.y);
  for (const l of linhas.slice(iCab + 1)) {
    const yCab = paginaComCabecalho.get(l.pagina);
    if (yCab !== undefined && l.y >= yCab - 0.5) continue; // título, resumo e o próprio cabeçalho repetido
    if (l.trechos.every((t) => rotulosCab.has(t.texto.trim().toLowerCase()))) continue;
    const celulas = colunas.map(() => "");
    for (const t of l.trechos) {
      const i = colunaDe(t);
      celulas[i] = celulas[i] ? `${celulas[i]} ${t.texto.trim()}` : t.texto.trim();
    }
    const temData = celulas.some((c) => DATA.test(c));
    const temValor = celulas.some((c) => DINHEIRO.test(c));
    if (temData && temValor) {
      dados.push({ pagina: l.pagina, y: l.y, celulas });
      continue;
    }
    // Continuação de uma descrição que quebrou em duas linhas
    const anterior = dados.at(-1);
    if (!temData && !temValor && anterior && anterior.pagina === l.pagina && anterior.y - l.y <= 14 && !/p[aá]gina\s+\d/i.test(textoDa(l))) {
      celulas.forEach((c, i) => {
        if (c) anterior.celulas[i] = anterior.celulas[i] ? `${anterior.celulas[i]} ${c}` : c;
      });
      anterior.y = l.y;
    }
  }

  // CPF e CNPJ em colunas separadas viram uma só
  let cabecalho = colunas.map((c) => c.rotulo);
  let corpo = dados.map((d) => d.celulas);
  const iCpf = cabecalho.findIndex((c) => /^cpf$/i.test(c));
  const iCnpj = cabecalho.findIndex((c) => /^cnpj$/i.test(c));
  if (iCpf >= 0 && iCnpj >= 0) {
    cabecalho = cabecalho.map((c, i) => (i === iCpf ? "CPF/CNPJ" : c)).filter((_, i) => i !== iCnpj);
    corpo = corpo.map((r) => r.map((c, i) => (i === iCpf ? c || r[iCnpj] : c)).filter((_, i) => i !== iCnpj));
  }

  // Conferência com o resumo
  const somaDe = (i: number) => corpo.reduce((s, r) => s.plus(valorBR(r[i] ?? "") ?? 0), new Decimal(0));
  const iValor = cabecalho.findIndex((c) => /^valor$/i.test(c.trim()));
  const iTotal = cabecalho.findIndex((c) => /^valor\s+total$/i.test(c.trim()));
  const somas = [iTotal, iValor].filter((i) => i >= 0).map(somaDe);
  if (!somas.length) somas.push(somaDe(cabecalho.findIndex((c) => /^valor/i.test(c.trim()))));
  const problemas: string[] = [];
  const quantidade = mQtd ? Number(mQtd[1]) : null;
  if (!corpo.length) problemas.push("Nenhuma conta foi encontrada na tabela do relatório.");
  if (total !== null && !somas.some((s) => s.eq(total!))) {
    problemas.push(`A soma das contas lidas (R$ ${somas[0].toFixed(2).replace(".", ",")}) não bate com o total do relatório (R$ ${total.replace(".", ",")}).`);
  }
  if (quantidade !== null && quantidade !== corpo.length) problemas.push(`Foram lidas ${corpo.length} contas, mas o relatório informa ${quantidade}.`);
  const confere = !corpo.length ? false : total === null && quantidade === null ? null : problemas.length === 0;
  const soma = (total !== null ? somas.find((s) => s.eq(total!)) : undefined) ?? somas[0];

  return {
    tipo,
    linhas: [cabecalho, ...corpo],
    resumo: { total, quantidade },
    conferencia: { soma: soma.toFixed(2), quantidade: corpo.length, confere, problemas },
  };
}

export async function lerRelatorioContasPdf(bytes: Uint8Array): Promise<RelatorioContasPdf> {
  let trechos: Trecho[];
  try {
    trechos = await trechosDoPdf(bytes);
  } catch {
    throw new RelatorioIlegivel("Não foi possível abrir este PDF. Confira se o arquivo não está protegido por senha ou corrompido.");
  }
  return lerRelatorioContasTrechos(trechos);
}

export function ehPdf(bytes: Uint8Array) {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
