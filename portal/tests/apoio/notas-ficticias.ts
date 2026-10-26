import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Content, TableCell } from "pdfmake/interfaces";
import { dvChave } from "../../src/lib/fiscal/chave";

/**
 * Notas de compra FICTÍCIAS para os testes da entrada de mercadorias: XML de
 * NF-e (a partir da nota de exemplo dos testes) e um DANFE em PDF com o
 * leiaute de "outro sistema" (rótulos em duas linhas, coluna de desconto,
 * chave sem espaços), diferente do DANFE gerado pelo portal.
 */

export function cnpjComDv(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const r = b.split("").reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

export function chaveNfe(p: { cnpjEmitente: string; numero: number; aamm: string; serie?: number }) {
  const base = `17${p.aamm}${p.cnpjEmitente}55${String(p.serie ?? 1).padStart(3, "0")}${String(p.numero).padStart(9, "0")}1${String(p.numero).padStart(8, "0")}`;
  return base + String(dvChave(base));
}

export const formatarCnpjTeste = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/** XML de NF-e de compra (3 itens) com fornecedor, destinatário, número e chave escolhidos. */
export function xmlCompraFicticio(p: {
  chave: string;
  numero: number;
  emitenteCnpj: string;
  emitenteNome: string;
  destinatarioCnpj: string;
  itens: { codigo: string; ean: string; descricao: string; ncm: string }[];
}) {
  const ANTIGOS = [
    { codigo: "D-100", ean: "7891234567895", descricao: "DIPIRONA 500MG 10 COMP", ncm: "30049099" },
    { codigo: "H-200", ean: "SEM GTIN", descricao: "SHAMPOO 300ML", ncm: "33051000" },
    { codigo: "A-300", ean: "7890000000017", descricao: "BISCOITO 200G", ncm: "19053100" },
  ];
  let xml = readFileSync(join(process.cwd(), "tests/fixtures/nfe-compra-farmacia.xml"), "utf8")
    .replaceAll("17260944555666000172550010000007891000007891", p.chave)
    .replaceAll("<CNPJ>44555666000172</CNPJ>", `<CNPJ>${p.emitenteCnpj}</CNPJ>`)
    .replaceAll("DISTRIBUIDORA FARMA (FICTICIA)", p.emitenteNome)
    .replaceAll("<CNPJ>11222333000181</CNPJ>", `<CNPJ>${p.destinatarioCnpj}</CNPJ>`)
    .replace("<nNF>789</nNF>", `<nNF>${p.numero}</nNF>`)
    .replace("<cNF>00000789</cNF>", `<cNF>${String(p.numero).padStart(8, "0")}</cNF>`)
    .replace(/<cDV>\d<\/cDV>/, `<cDV>${p.chave.slice(-1)}</cDV>`);
  ANTIGOS.forEach((a, i) => {
    const n = p.itens[i];
    xml = xml
      .replace(`<cProd>${a.codigo}</cProd>`, `<cProd>${n.codigo}</cProd>`)
      .replaceAll(`<cEAN>${a.ean}</cEAN>`, `<cEAN>${n.ean}</cEAN>`)
      .replaceAll(`<cEANTrib>${a.ean}</cEANTrib>`, `<cEANTrib>${n.ean}</cEANTrib>`)
      .replace(`<xProd>${a.descricao}</xProd>`, `<xProd>${n.descricao}</xProd>`)
      .replace(`<NCM>${a.ncm}</NCM>`, `<NCM>${n.ncm}</NCM>`);
  });
  return xml;
}

export interface ItemDanfeFicticio {
  cod: string;
  desc: string;
  ncm: string;
  cst: string;
  cfop: string;
  un: string;
  qtd: string;
  vun: string;
  vtot: string;
  vdesc: string;
}

/** DANFE de "outro sistema" (PDF com texto), para testar a leitura do PDF. */
export async function danfeFicticio(p: {
  chave: string;
  destinatario: string;
  totalProdutos: string;
  itens: ItemDanfeFicticio[];
  emitenteNome?: string;
  dataEmissao?: string;
  /** Itens a partir deste índice vão para a página seguinte (sem repetir o cabeçalho). */
  quebraPagina?: number;
}): Promise<Buffer> {
  const mod = (await import("pdfmake")) as unknown as { default?: PdfMake } & PdfMake;
  const pm = mod.default ?? mod;
  const pasta = join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto");
  pm.setFonts({
    Roboto: {
      normal: join(pasta, "Roboto-Regular.ttf"),
      bold: join(pasta, "Roboto-Medium.ttf"),
      italics: join(pasta, "Roboto-Italic.ttf"),
      bolditalics: join(pasta, "Roboto-MediumItalic.ttf"),
    },
  });
  pm.setUrlAccessPolicy(() => false);
  pm.setLocalAccessPolicy((caminho) => caminho.startsWith(pasta));

  const cab: TableCell[] = ["CÓDIGO\nPRODUTO", "DESCRIÇÃO DO PRODUTO / SERVIÇO", "NCM/SH", "O/CSOSN", "CFOP", "UN.", "QTD.", "V.UNIT.", "V.TOTAL", "V.DESC.", "BC ICMS", "V.ICMS", "ALÍQ\nICMS"].map(
    (t) => ({ text: t, fontSize: 5, bold: true, alignment: "center" }),
  );
  const celula = (t: string, alinhamento: "left" | "right" | "center" = "right"): TableCell => ({ text: t, fontSize: 6, alignment: alinhamento });
  const linhas: TableCell[][] = p.itens.map((i) => [
    celula(i.cod, "left"),
    celula(i.desc, "left"),
    celula(i.ncm, "center"),
    celula(i.cst, "center"),
    celula(i.cfop, "center"),
    celula(i.un, "center"),
    celula(i.qtd),
    celula(i.vun),
    celula(i.vtot),
    celula(i.vdesc),
    celula("0,00"),
    celula("0,00"),
    celula("0,00"),
  ]);
  const quebra = p.quebraPagina ?? linhas.length;
  const quadro = (corpo: TableCell[][], novaPagina: boolean): Content => ({
    table: { headerRows: 1, widths: [34, 90, 34, 22, 20, 18, 38, 38, 38, 30, 26, 26, 20], body: [cab, ...corpo] },
    layout: "noBorders",
    ...(novaPagina ? { pageBreak: "before" as const } : {}),
  });
  const conteudo: Content[] = [
    ...(p.emitenteNome
      ? [{ text: `RECEBEMOS DE ${p.emitenteNome} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`, fontSize: 6 } as Content]
      : []),
    { text: "DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA", fontSize: 9, bold: true },
    {
      table: {
        widths: [180, 180, 120],
        body: [
          [
            { text: "CHAVE DE ACESSO", fontSize: 5 },
            { text: "DATA DE EMISSÃO", fontSize: 5 },
            { text: "CNPJ DESTINATÁRIO", fontSize: 5 },
          ],
          [
            { text: p.chave, fontSize: 7 },
            { text: p.dataEmissao ?? "15/09/2026", fontSize: 7 },
            { text: p.destinatario, fontSize: 7 },
          ],
        ],
      },
      margin: [0, 6, 0, 6],
    },
    {
      table: {
        widths: [120, 120, 120],
        body: [
          [
            { text: "VALOR TOTAL DOS PRODUTOS", fontSize: 5 },
            { text: "VALOR DO FRETE", fontSize: 5 },
            { text: "VALOR TOTAL DA NOTA", fontSize: 5 },
          ],
          [
            { text: p.totalProdutos, fontSize: 7, alignment: "right" },
            { text: "0,00", fontSize: 7, alignment: "right" },
            { text: p.totalProdutos, fontSize: 7, alignment: "right" },
          ],
        ],
      },
      margin: [0, 0, 0, 6],
    },
    { text: "DADOS DOS PRODUTOS / SERVIÇOS", fontSize: 6, bold: true },
    quadro(linhas.slice(0, quebra), false),
    ...(quebra < linhas.length ? [quadro(linhas.slice(quebra), true)] : []),
    { text: "DADOS ADICIONAIS", fontSize: 6, bold: true, margin: [0, 8, 0, 0] },
    { text: "Documento emitido por ME ou EPP optante pelo Simples Nacional.", fontSize: 6 },
  ];
  return pm.createPdf({ pageSize: "A4", pageMargins: [16, 16, 16, 16], defaultStyle: { font: "Roboto" }, content: conteudo }).getBuffer();
}

interface PdfMake {
  setFonts(f: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(fn: (url: string) => boolean): void;
  setLocalAccessPolicy(fn: (caminho: string) => boolean): void;
  createPdf(doc: import("pdfmake/interfaces").TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
}
