import "server-only";
import path from "node:path";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora, formatarPercentual } from "@/lib/formatos";
import type { Secao } from "./tabelas";

/**
 * Gera Excel (exceljs) e PDF (pdfmake) a partir de seções tabulares.
 * Mesmo padrão visual da exportação de lançamentos.
 */

const MARROM = "FF4A2C1D";
const FORMATO_MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

/** Evita fórmulas ao abrir no Excel (texto começando com =, +, -, @). */
function textoSeguro(v: string) {
  return /^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
}

export function nomeArquivo(partes: string[]) {
  return partes
    .join("-")
    .normalize("NFD")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);
}

export async function gerarXlsx(titulo: string, subtitulo: string, secoes: Secao[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  const usados = new Set<string>();
  for (const s of secoes) {
    let nome = s.titulo.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Relatório";
    while (usados.has(nome)) nome = `${nome.slice(0, 26)} ${usados.size}`;
    usados.add(nome);
    const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: 4 }] });
    ws.addRow([titulo]).font = { bold: true, size: 13, color: { argb: MARROM } };
    ws.addRow([`${s.titulo} · ${subtitulo}`]).font = { color: { argb: "FF6B625B" } };
    ws.addRow([]);
    const cab = ws.addRow(s.colunas.map((c) => c.rotulo));
    cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARROM } };
    s.linhas.forEach((linha, i) => {
      const r = ws.addRow(
        linha.map((v, c) => {
          if (v === null || v === undefined || v === "") return null;
          const tipo = s.colunas[c]?.tipo;
          if (tipo === "moeda") return dec(v).toNumber();
          if (tipo === "percentual") return Number(v) / 100;
          if (tipo === "numero") return Number(v);
          return textoSeguro(String(v));
        }),
      );
      if (s.destaques?.includes(i)) r.font = { bold: true };
    });
    s.colunas.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.tipo === "moeda") col.numFmt = FORMATO_MOEDA;
      if (c.tipo === "percentual") col.numFmt = "0.0%";
      col.width = i === 0 ? 44 : c.tipo === "texto" ? 20 : 16;
    });
    if (s.observacao) {
      ws.addRow([]);
      ws.addRow([s.observacao]).font = { italic: true, color: { argb: "FF6B625B" } };
    }
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function celulaPdf(v: string | number | null, tipo: string) {
  if (v === null || v === undefined || v === "") return { text: "—", alignment: tipo === "texto" ? "left" : "right" };
  if (tipo === "moeda") return { text: formatarMoeda(v), alignment: "right", color: dec(v).isNegative() ? "#b91c1c" : undefined };
  if (tipo === "percentual") return { text: formatarPercentual(Number(v), 1), alignment: "right" };
  if (tipo === "numero") return { text: Number(v).toLocaleString("pt-BR"), alignment: "right" };
  return { text: String(v), alignment: "left" };
}

export async function gerarPdf(titulo: string, subtitulo: string, secoes: Secao[]): Promise<Buffer> {
  const pdfmake = (await import("pdfmake")).default;
  const pasta = path.join(process.cwd(), "node_modules/pdfmake/fonts/Roboto");
  pdfmake.setFonts({
    Roboto: {
      normal: path.join(pasta, "Roboto-Regular.ttf"),
      bold: path.join(pasta, "Roboto-Medium.ttf"),
      italics: path.join(pasta, "Roboto-Italic.ttf"),
      bolditalics: path.join(pasta, "Roboto-MediumItalic.ttf"),
    },
  });
  pdfmake.setUrlAccessPolicy(() => false);
  const largas = secoes.some((s) => s.colunas.length > 7);
  const conteudo: unknown[] = [
    { text: titulo, style: "titulo" },
    { text: subtitulo, style: "subtitulo" },
  ];
  for (const s of secoes) {
    conteudo.push({ text: s.titulo, style: "secao" });
    conteudo.push({
      table: {
        headerRows: 1,
        widths: s.colunas.map((_, i) => (i === 0 ? "*" : "auto")),
        body: [
          s.colunas.map((c) => ({ text: c.rotulo, style: "cabecalho", alignment: c.tipo === "texto" ? "left" : "right" })),
          ...s.linhas.map((linha, i) =>
            linha.map((v, c) => ({ ...celulaPdf(v, s.colunas[c]?.tipo ?? "texto"), bold: s.destaques?.includes(i) ?? false })),
          ),
        ],
      },
      layout: {
        hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => "#e7e2dc",
        fillColor: (i: number) => (i === 0 ? "#4a2c1d" : null),
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      fontSize: largas && s.colunas.length > 10 ? 6.5 : 8,
    });
    if (s.observacao) conteudo.push({ text: s.observacao, style: "observacao" });
  }
  const doc = pdfmake.createPdf({
    pageSize: "A4",
    pageOrientation: largas ? "landscape" : "portrait",
    pageMargins: [32, 36, 32, 40],
    info: { title: titulo, creator: "Portal Guarese's ON" },
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#1f1a17" },
    styles: {
      titulo: { fontSize: 15, bold: true, color: "#4a2c1d" },
      subtitulo: { fontSize: 9, color: "#6b625b", margin: [0, 2, 0, 10] },
      secao: { fontSize: 11, bold: true, color: "#4a2c1d", margin: [0, 12, 0, 6] },
      cabecalho: { bold: true, color: "#ffffff", fontSize: 8 },
      observacao: { fontSize: 7.5, italics: true, color: "#6b625b", margin: [0, 4, 0, 0] },
    },
    content: conteudo as never,
    footer: (pagina: number, total: number) => ({
      columns: [
        { text: `Gerado em ${formatarDataHora(new Date().toISOString())} · Portal Guarese's ON`, fontSize: 7, color: "#6b625b" },
        { text: `Página ${pagina} de ${total}`, fontSize: 7, color: "#6b625b", alignment: "right" },
      ],
      margin: [32, 12, 32, 0],
    }),
  });
  return (await doc.getBuffer()) as Buffer;
}
