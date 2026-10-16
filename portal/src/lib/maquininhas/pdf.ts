/**
 * Relatórios de vendas em PDF das adquirentes.
 *
 * O PDF não tem colunas: o portal extrai o texto e reconhece os formatos que
 * conhece, transformando cada linha de venda numa linha de planilha (com um
 * cabeçalho fixo). Daí em diante o caminho é o mesmo do CSV/Excel: o formato
 * é lembrado pela assinatura do cabeçalho e cada linha é conferida com a taxa
 * do contrato.
 *
 * Formatos conhecidos:
 *  - Cielo, "Lista de Vendas" (Minha Conta Cielo → Vendas → exportar PDF),
 *    visualizada por forma de pagamento: uma linha por dia e forma, com a
 *    quantidade de vendas, o valor bruto, a taxa/tarifa e o valor líquido.
 *    Ex.: "10/10/2026 Crédito à vista 3 R$ 601,10 -R$ 19,04 R$ 582,06".
 *    Visualizada por bandeira, a lista não diz se é débito ou crédito (sem a
 *    taxa do contrato para conferir): o portal pede a visualização por forma
 *    de pagamento.
 */

export interface RelatorioPdf {
  /** Linhas como numa planilha: a primeira é o cabeçalho. */
  linhas: string[][];
  /** Adquirente reconhecida pelo texto do relatório. */
  adquirente: "cielo";
  descricao: string;
}

/** Marca o cabeçalho para que a assinatura do formato não se confunda com a de uma planilha. */
export const ORIGEM_CIELO_PDF = "Origem: PDF Lista de Vendas Cielo";

const VALOR = String.raw`(-?\s?R\$\s?-?[\d.]+,\d{2})`;
const LINHA_CIELO = new RegExp(String.raw`^(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(\d{1,6})\s+${VALOR}\s+${VALOR}\s+${VALOR}\s*$`);

/** Valor do PDF ("-R$ 19,04" → "-19,04"). */
function valorTexto(t: string): string {
  const negativo = t.includes("-");
  const numero = t.replace(/[^\d.,]/g, "");
  return `${negativo ? "-" : ""}${numero}`;
}

/**
 * Reconhece o texto de um relatório "Lista de Vendas" da Cielo. `null` quando
 * não é esse relatório; `{ erro }` quando é, mas não dá para conferir.
 */
export function linhasDoTextoCielo(texto: string): RelatorioPdf | { erro: string } | null {
  const t = texto.replace(/\r/g, "");
  if (!/\bcielo\b/i.test(t) || !/Lista de Vendas/i.test(t)) return null;
  if (/Visualizar por:\s*Bandeira/i.test(t) || /Data da venda\s+Bandeira\b/i.test(t)) {
    return {
      erro: "Esta Lista de Vendas da Cielo está separada por bandeira e não diz se cada venda é débito ou crédito. Gere de novo no site da Cielo com “Visualizar por: Forma de pagamento” e envie o PDF.",
    };
  }
  const linhas: string[][] = [["Data da venda", "Forma de pagamento", "Quantidade de vendas", "Valor bruto", "Valor taxa/tarifa", "Valor líquido", ORIGEM_CIELO_PDF]];
  for (const bruta of t.split("\n")) {
    const m = LINHA_CIELO.exec(bruta.trim().replace(/\s+/g, " "));
    if (!m) continue;
    linhas.push([m[1], m[2], m[3], valorTexto(m[4]), valorTexto(m[5]), valorTexto(m[6]), ""]);
  }
  if (linhas.length < 2) return { erro: "A Lista de Vendas da Cielo não tem vendas no período escolhido." };
  return { linhas, adquirente: "cielo", descricao: "Cielo — Lista de Vendas (PDF, por forma de pagamento)" };
}

/** Texto do PDF (todas as páginas, uma linha por linha do relatório). */
export async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n");
}

export class PdfNaoReconhecido extends Error {
  constructor(mensagem?: string) {
    super(
      mensagem ??
        "Este PDF não está num formato de relatório de vendas que o portal sabe ler. Baixe o relatório de vendas em Excel (.xlsx) ou CSV no site da adquirente e envie de novo — ou, na Cielo, a “Lista de Vendas” em PDF.",
    );
    this.name = "PdfNaoReconhecido";
  }
}

/** Lê um relatório de vendas em PDF (formatos conhecidos). */
export async function lerRelatorioPdf(bytes: Uint8Array): Promise<RelatorioPdf> {
  const texto = await textoDoPdf(bytes);
  const r = linhasDoTextoCielo(texto);
  if (!r) throw new PdfNaoReconhecido();
  if ("erro" in r) throw new PdfNaoReconhecido(r.erro);
  return r;
}
