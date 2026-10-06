import "server-only";
import type { Content, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import { logoHorizontalSvg } from "@/lib/marca/logo";
import { COR, carregarPdfMake } from "@/lib/relatorios/pdf";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarCompetencia, formatarCpf, formatarDataHora, nomeMes } from "@/lib/formatos";
import { valorPorExtenso } from "./extenso";
import { codigoDeclaracao } from "./codigo";
import { totais } from "./faturamento";

/**
 * PDF da declaração de faturamento, com a identidade do escritório: logo do
 * escritório e do cliente no topo, cores da marca, tabela dos meses, total por
 * extenso e as linhas de assinatura do representante legal e do contador.
 */

export interface DeclaracaoPdf {
  id: string;
  empresa: { razao: string; documento: string; endereco: string };
  escritorio: { nome: string; razao: string; cnpj: string; endereco: string; email: string | null; telefone: string | null };
  logoEscritorio: { dados: string } | null;
  logoCliente: { dados: string } | null;
  periodo: { inicio: string; fim: string };
  meses: { competencia: string; valor: string | number }[];
  finalidade: string | null;
  observacao: string | null;
  cidade: string;
  uf: string | null;
  data: string; // AAAA-MM-DD
  representante: { nome: string; cpf: string | null; cargo: string | null };
  contador: { nome: string; crc: string };
  situacao: "emitida" | "assinada" | "cancelada";
  emitidaEm: string;
}

/** "2026-10-06" → "6 de outubro de 2026". */
export function dataPorExtenso(data: string): string {
  const [a, m, d] = data.slice(0, 10).split("-").map(Number);
  return `${d} de ${nomeMes(m)} de ${a}`;
}

const mesAno = (comp: string) => {
  const t = formatarCompetencia(comp, true);
  return t.charAt(0).toUpperCase() + t.slice(1);
};


export async function gerarPdfDeclaracao(d: DeclaracaoPdf): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const { total, media } = totais(d.meses.map((m) => m.valor));
  const periodo = `${formatarCompetencia(d.periodo.inicio, true)} a ${formatarCompetencia(d.periodo.fim, true)}`;
  const qtd = d.meses.length;

  const logoEsc: Content = d.logoEscritorio ? { image: d.logoEscritorio.dados, fit: [160, 48] } : { svg: logoHorizontalSvg(COR.marrom), width: 150 };
  const logoCli: Content = d.logoCliente ? { image: d.logoCliente.dados, fit: [130, 48], alignment: "right" } : { text: "" };

  // Até 12 meses, uma coluna; mais que isso, duas colunas lado a lado (tudo numa folha)
  const duasColunas = qtd > 12;
  const compacto = qtd > 24;
  const porColuna = duasColunas ? Math.ceil(qtd / 2) : qtd;
  const celulas = (m: { competencia: string; valor: string | number } | undefined, faixa: boolean): TableCell[] =>
    m
      ? [
          { text: mesAno(m.competencia), fillColor: faixa ? COR.bege : undefined },
          { text: formatarMoeda(m.valor), alignment: "right", fillColor: faixa ? COR.bege : undefined, noWrap: true },
        ]
      : [{ text: "", fillColor: faixa ? COR.bege : undefined }, { text: "", fillColor: faixa ? COR.bege : undefined }];
  const linhas: TableCell[][] = Array.from({ length: porColuna }, (_, i) =>
    duasColunas ? [...celulas(d.meses[i], i % 2 === 1), ...celulas(d.meses[i + porColuna], i % 2 === 1)] : celulas(d.meses[i], i % 2 === 1),
  );
  // Objetos novos a cada uso: o pdfmake anota as células que desenha
  const cabecalhoTabela = (): TableCell[] => [
    { text: "Mês", bold: true, color: "#ffffff", fillColor: COR.marrom },
    { text: "Faturamento bruto", bold: true, color: "#ffffff", fillColor: COR.marrom, alignment: "right" },
  ];
  const rodapeTabela = (rotulo: string, valor: string, destaque: boolean): TableCell[] => {
    const estilo = destaque ? { bold: true, fillColor: COR.begeForte } : { color: COR.cinza };
    return duasColunas
      ? [{ text: rotulo, colSpan: 3, ...estilo }, {}, {}, { text: valor, alignment: "right", noWrap: true, ...estilo }]
      : [{ text: rotulo, ...estilo }, { text: valor, alignment: "right", noWrap: true, ...estilo }];
  };

  const assinatura = (linhas: string[]): Content => ({
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.8, lineColor: "#2b211b" }], margin: [0, 0, 0, 4] },
      ...linhas.map((t, i) => ({ text: t, fontSize: i === 0 ? 9.5 : 8.5, bold: i === 0, color: i === 0 ? "#2b211b" : COR.cinza })),
    ],
    alignment: "left",
  });

  const representanteLinhas = [
    d.representante.nome,
    ...(d.representante.cargo ? [d.representante.cargo] : []),
    ...(d.representante.cpf ? [`CPF ${formatarCpf(d.representante.cpf)}`] : []),
    d.empresa.razao,
  ];
  const contadorLinhas = [d.contador.nome, `Contador(a) — CRC ${d.contador.crc}`, d.escritorio.razao];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [56, 40, 56, 64],
    info: { title: `Declaração de faturamento — ${d.empresa.razao}`, author: d.escritorio.nome, creator: "Portal Guarese's ON" },
    watermark: d.situacao === "cancelada" ? { text: "CANCELADA", opacity: 0.12, bold: true, fontSize: 90, color: COR.vermelho } : undefined,
    footer: (pagina: number, total: number) => ({
      margin: [56, 18, 56, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.6, lineColor: COR.begeForte }], margin: [0, 0, 0, 5] },
        {
          columns: [
            {
              text: [
                { text: `${d.escritorio.razao} — CNPJ ${formatarCnpj(d.escritorio.cnpj)}\n`, bold: true, color: COR.marrom },
                `${d.escritorio.endereco}${d.escritorio.email ? ` — ${d.escritorio.email}` : ""}${d.escritorio.telefone ? ` — ${d.escritorio.telefone}` : ""}`,
              ],
              fontSize: 7,
              color: COR.cinza,
            },
            {
              width: 150,
              alignment: "right",
              fontSize: 7,
              color: COR.cinza,
              text: `Código ${codigoDeclaracao(d.id)}\nEmitida em ${formatarDataHora(d.emitidaEm)} · pág. ${pagina}/${total}`,
            },
          ],
        },
      ],
    }),
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3, color: "#2b211b" },
    content: [
      { columns: [{ width: "*", stack: [logoEsc] }, { width: "auto", stack: [logoCli] }], columnGap: 16 },
      { canvas: [{ type: "rect", x: 0, y: 0, w: 483, h: 3, color: COR.marrom }], margin: [0, 10, 0, 0] },
      { text: "DECLARAÇÃO DE FATURAMENTO", alignment: "center", bold: true, fontSize: 16, color: COR.marrom, characterSpacing: 1.2, margin: [0, 16, 0, 12] },
      {
        text: [
          "Declaramos, para os devidos fins, que a empresa ",
          { text: d.empresa.razao, bold: true },
          ", inscrita no CNPJ sob o nº ",
          { text: formatarCnpj(d.empresa.documento), bold: true },
          d.empresa.endereco ? `, com sede em ${d.empresa.endereco}` : "",
          `, obteve no período de ${periodo} (${qtd} ${qtd === 1 ? "mês" : "meses"}) o faturamento bruto mensal discriminado abaixo:`,
        ],
        alignment: "justify",
      },
      {
        margin: duasColunas ? [0, 10, 0, 4] : [60, 10, 60, 4],
        fontSize: compacto ? 8.5 : duasColunas ? 9.5 : 10,
        table: {
          headerRows: 1,
          widths: duasColunas ? ["*", 105, "*", 105] : ["*", 150],
          body: [
            duasColunas ? [...cabecalhoTabela(), ...cabecalhoTabela()] : cabecalhoTabela(),
            ...linhas,
            rodapeTabela("Total do período", formatarMoeda(total), true),
            rodapeTabela("Média mensal", formatarMoeda(media), false),
          ],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length - 2 || i === node.table.body.length ? 0.8 : 0),
          vLineWidth: () => 0,
          hLineColor: () => COR.marrom,
          paddingTop: () => (compacto ? 1.2 : 2.5),
          paddingBottom: () => (compacto ? 1.2 : 2.5),
          paddingLeft: () => 8,
          paddingRight: () => 8,
        },
      },
      {
        text: [
          "O faturamento total do período soma ",
          { text: formatarMoeda(total), bold: true },
          ` (${valorPorExtenso(total)}).`,
        ],
        alignment: "justify",
        margin: [0, 8, 0, 0],
      },
      ...(d.finalidade ? [{ text: `Esta declaração destina-se a ${d.finalidade.replace(/\.$/, "")}.`, alignment: "justify", margin: [0, 8, 0, 0] } as Content] : []),
      ...(d.observacao ? [{ text: d.observacao, fontSize: 9, color: COR.cinza, alignment: "justify", margin: [0, 8, 0, 0] } as Content] : []),
      // Fechamento, data e assinaturas sempre juntos na mesma página
      {
        unbreakable: true,
        stack: [
          { text: "Por ser expressão da verdade, firmamos a presente declaração.", margin: [0, 10, 0, 0] },
          { text: `${d.cidade}${d.uf ? ` – ${d.uf}` : ""}, ${dataPorExtenso(d.data)}.`, alignment: "right", margin: [0, 14, 0, 0] },
          { columns: [assinatura(representanteLinhas), assinatura(contadorLinhas)], columnGap: 40, margin: [0, 46, 0, 0] },
        ],
      },
    ],
  };
  return pm.createPdf(doc).getBuffer();
}
