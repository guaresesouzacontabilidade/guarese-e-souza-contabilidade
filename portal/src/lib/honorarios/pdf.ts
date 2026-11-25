import "server-only";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { LOGO_ESCRITORIO_PNG } from "@/lib/marca/logo-png";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { numeroCobranca } from "./comum";

/**
 * PDF da cobrança (para o cliente baixar ou receber anexo no e-mail): timbre
 * do escritório, itens, vencimento, QR code e Pix copia e cola. Não é boleto:
 * o pagamento é conferido pelo escritório.
 */

export interface CobrancaPdf {
  ano: number;
  numero: number;
  descricao: string;
  pagador: { nome: string; documento: string | null };
  itens: { descricao: string; quantidade: number; valor_unitario: number; valor: number }[];
  valor: number;
  vencimento: string;
  situacao: string;
  pagoEm: string | null;
  valorPago: number | null;
  /** Valor com multa e juros, quando gerado depois do vencimento. */
  valorAtualizado: { valor: string; data: string; multa: string; juros: string } | null;
  pix: string | null;
  encargos: { multa: string; juros: string } | null;
  escritorio: {
    nome: string;
    razao_social: string;
    cnpj: string;
    endereco: string | null;
    telefone: string | null;
    email: string | null;
  };
}

const ESCURO = "#07461f"; // verde da Catarinense
const AREIA = "#8e1018"; // vermelho da Catarinense (faixas)
const LINHA_TABELA = "#c9d4cc";
const TEXTO = "#2b2522";
const CINZA = "#6f6862";
const FUNDO = "#eef4ef";

export function nomeArquivoCobranca(c: Pick<CobrancaPdf, "ano" | "numero" | "pagador">) {
  const nome = c.pagador.nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `Cobranca_${String(c.numero).padStart(4, "0")}_${c.ano}_${nome}.pdf`;
}

export async function gerarPdfCobranca(c: CobrancaPdf): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const paga = c.situacao === "paga";
  const cancelada = c.situacao === "cancelada";
  const valorParaPagar = c.valorAtualizado?.valor ?? String(c.valor);

  const cabecalho: Content = {
    columns: [
      { image: LOGO_ESCRITORIO_PNG, fit: [96, 57] },
      {
        width: "*",
        margin: [14, 4, 0, 0],
        stack: [
          { text: c.escritorio.nome.toUpperCase(), bold: true, fontSize: 12, color: ESCURO, characterSpacing: 0.4 },
          { text: c.escritorio.razao_social, fontSize: 9, color: CINZA, margin: [0, 2, 0, 0] },
          { text: `CNPJ ${formatarDocumento(c.escritorio.cnpj)}`, fontSize: 9, color: CINZA },
          ...(c.escritorio.endereco ? [{ text: c.escritorio.endereco, fontSize: 9, color: CINZA }] : []),
          {
            text: [c.escritorio.telefone ? formatarTelefone(c.escritorio.telefone) : null, c.escritorio.email].filter(Boolean).join("  ·  "),
            fontSize: 9,
            color: CINZA,
          },
        ],
      },
      {
        width: 150,
        alignment: "right",
        stack: [
          { text: "COBRANÇA", fontSize: 9, color: CINZA, characterSpacing: 1.5 },
          { text: `nº ${numeroCobranca(c)}`, fontSize: 15, bold: true, color: ESCURO, margin: [0, 2, 0, 0] },
          { text: `Vencimento ${formatarData(c.vencimento)}`, fontSize: 10, color: TEXTO, margin: [0, 6, 0, 0] },
        ],
      },
    ],
  };

  const itens: Content = {
    table: {
      headerRows: 1,
      widths: ["*", 50, 80, 80],
      body: [
        [
          { text: "Descrição", bold: true, fillColor: FUNDO },
          { text: "Qtde.", bold: true, fillColor: FUNDO, alignment: "right" },
          { text: "Valor unit.", bold: true, fillColor: FUNDO, alignment: "right" },
          { text: "Total", bold: true, fillColor: FUNDO, alignment: "right" },
        ],
        ...c.itens.map((i) => [
          { text: i.descricao },
          { text: Number(i.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 3 }), alignment: "right" as const },
          { text: formatarMoeda(i.valor_unitario), alignment: "right" as const },
          { text: formatarMoeda(i.valor), alignment: "right" as const },
        ]),
        [
          { text: "Total da cobrança", bold: true, colSpan: 3 },
          {},
          {},
          { text: formatarMoeda(c.valor), bold: true, alignment: "right" as const },
        ],
      ],
    },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length - 1 || i === node.table.body.length ? 0.8 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => LINHA_TABELA,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    fontSize: 10,
    margin: [0, 16, 0, 0],
  };

  const blocoPix: Content = paga
    ? {
        margin: [0, 22, 0, 0],
        table: {
          widths: ["*"],
          body: [[{ text: `PAGA em ${formatarData(c.pagoEm)} — ${formatarMoeda(c.valorPago)}. Obrigado!`, bold: true, color: "#1f6b3a", alignment: "center", margin: [0, 10, 0, 10] }]],
        },
        layout: { hLineColor: () => "#1f6b3a", vLineColor: () => "#1f6b3a" },
      }
    : cancelada
      ? { text: "Cobrança cancelada.", bold: true, color: "#9b1c1c", margin: [0, 22, 0, 0] }
      : c.pix
        ? {
            margin: [0, 22, 0, 0],
            columns: [
              { width: 150, qr: c.pix, fit: 150, eccLevel: "M" },
              {
                width: "*",
                margin: [16, 0, 0, 0],
                stack: [
                  { text: "Pague com Pix", bold: true, fontSize: 13, color: ESCURO },
                  {
                    text: c.valorAtualizado
                      ? `Valor atualizado até ${formatarData(c.valorAtualizado.data)}: ${formatarMoeda(valorParaPagar)} (multa ${formatarMoeda(c.valorAtualizado.multa)} + juros ${formatarMoeda(c.valorAtualizado.juros)})`
                      : `Valor: ${formatarMoeda(valorParaPagar)}`,
                    fontSize: 10,
                    margin: [0, 4, 0, 8],
                  },
                  { text: "Abra o aplicativo do seu banco, escolha Pix e aponte a câmera para o QR code — ou use o Pix copia e cola:", fontSize: 9, color: CINZA },
                  { text: c.pix, fontSize: 7.5, font: "Roboto", color: TEXTO, margin: [0, 4, 0, 0] },
                ],
              },
            ],
          }
        : { text: "Fale com o escritório para receber os dados de pagamento.", color: CINZA, margin: [0, 22, 0, 0] };

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [48, 48, 48, 60],
    info: { title: `Cobrança ${numeroCobranca(c)} — ${c.descricao}`, author: c.escritorio.nome },
    defaultStyle: { font: "Roboto", fontSize: 10, color: TEXTO },
    background: () => ({ canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 8, color: ESCURO }, { type: "rect", x: 0, y: 8, w: 595.28, h: 3, color: AREIA }] }),
    footer: () => ({
      margin: [48, 18, 48, 0],
      fontSize: 8,
      color: CINZA,
      text: "Este documento não é boleto. Ao pagar pelo Pix, o escritório confere o pagamento e envia o recibo.",
    }),
    content: [
      cabecalho,
      {
        margin: [0, 22, 0, 0],
        table: {
          widths: [90, "*"],
          body: [
            [{ text: "Cliente", bold: true, fillColor: FUNDO }, { text: `${c.pagador.nome}${c.pagador.documento ? ` — ${formatarDocumento(c.pagador.documento)}` : ""}` }],
            [{ text: "Referente a", bold: true, fillColor: FUNDO }, { text: c.descricao }],
          ],
        },
        layout: { hLineColor: () => LINHA_TABELA, vLineColor: () => LINHA_TABELA, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 6, paddingBottom: () => 6 },
      },
      itens,
      blocoPix,
      ...(c.encargos && !paga && !cancelada
        ? [{ text: `Após o vencimento: multa de ${c.encargos.multa}% e juros de ${c.encargos.juros}% ao mês, proporcionais aos dias de atraso.`, fontSize: 8.5, color: CINZA, margin: [0, 16, 0, 0] as [number, number, number, number] }]
        : []),
    ],
  };
  return pm.createPdf(doc).getBuffer();
}
