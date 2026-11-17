import "server-only";
import type { Column, Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { logoVerticalSvg, simboloSvg } from "@/lib/marca/logo";
import { valorPorExtenso } from "@/lib/declaracoes/extenso";
import { dataPorExtenso } from "@/lib/declaracoes/pdf";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarDocumento, formatarTelefone, nomeMes } from "@/lib/formatos";
import { FORMAS_PAGAMENTO, numeroRecibo } from "./comum";

export { FORMAS_PAGAMENTO, numeroRecibo };

/**
 * PDF do recibo de honorários com o timbre do escritório, no modelo usado
 * pelo escritório: faixas escura e bege no alto e no pé da página, logo à
 * esquerda e contador com o CRC à direita, a marca "ON" clarinha ao fundo,
 * dados do escritório, número e valor, quadro recebedor/pagador/referência,
 * texto com o valor por extenso, local e data, assinatura e rodapé.
 */

export interface EmitenteRecibo {
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  endereco: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  contador_nome: string | null;
  contador_crc: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface ReciboPdf {
  ano: number;
  numero: number;
  valor: string | number;
  pagador: { nome: string; documento: string | null };
  referencia: string;
  competencia: string | null;
  descricao: string | null;
  data: string; // AAAA-MM-DD
  cidade: string;
  uf: string | null;
  formaPagamento: string | null;
  nfseNumero: string | null;
  observacao: string | null;
  emitente: EmitenteRecibo;
  /** Logo enviada pelo escritório (data URL); sem ela, a logo oficial em vetor. */
  logo: { dados: string } | null;
  situacao: "emitido" | "cancelado";
  motivoCancelamento?: string | null;
  /** Assinatura digital (ICP-Brasil) que vai ser aplicada ao arquivo: o texto sai abaixo da assinatura. */
  assinatura?: { titular: string; documento: string; data: Date } | null;
}

const ESCURO = "#3b3330";
const AREIA = "#b6a696";
const TEXTO = "#2b2522";
const CINZA = "#6f6862";
const FUNDO_ROTULO = "#efe9e3";
const LINHA = "#cfc8c1";

/** "2026-11-01" → "novembro/2026" ou "novembro de 2026". */
function competenciaTexto(comp: string, longo: boolean) {
  const mes = nomeMes(Number(comp.slice(5, 7))).toLowerCase();
  return longo ? `${mes} de ${comp.slice(0, 4)}` : `${mes}/${comp.slice(0, 4)}`;
}

function documentoTexto(doc: string | null) {
  if (!doc) return null;
  return `${doc.length === 11 ? "CPF" : "CNPJ"}: ${formatarDocumento(doc)}`;
}

/** Nome do arquivo do PDF (ex.: Recibo_007_2026_Lake_Side_Novembro.pdf). */
export function nomeArquivoRecibo(r: Pick<ReciboPdf, "ano" | "numero" | "pagador" | "competencia" | "data">) {
  const limpar = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const curto = r.pagador.nome
    .split(/\s+/)
    .filter((p) => !/^(ltda|me|epp|eireli|s\.?a\.?|condominio|condomínio|de|da|do|dos|das|e|\(?demonstra[çc][ãa]o\)?)$/i.test(p))
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  const nome = nomeMes(Number((r.competencia ?? r.data).slice(5, 7)));
  const mes = nome.charAt(0).toUpperCase() + nome.slice(1);
  return `Recibo_${String(r.numero).padStart(3, "0")}_${r.ano}_${limpar(curto || r.pagador.nome)}_${limpar(mes)}.pdf`;
}

export async function gerarPdfRecibo(r: ReciboPdf): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const e = r.emitente;
  const cancelado = r.situacao === "cancelado";
  const largura = 595.28;
  const altura = 841.89;
  const margem = 72;
  const util = largura - margem * 2;

  const referenciaTexto = r.descricao
    ? r.descricao.replace(/\.$/, "")
    : `pagamento de ${r.referencia.charAt(0).toLowerCase()}${r.referencia.slice(1)} / prestação de serviços contábeis${r.competencia ? ` da competência de ${competenciaTexto(r.competencia, true)}` : ""}`;
  const extras = [
    r.formaPagamento ? `pago por ${FORMAS_PAGAMENTO[r.formaPagamento] ?? r.formaPagamento}` : null,
    r.nfseNumero ? `correspondente à NFS-e nº ${r.nfseNumero}` : null,
  ].filter(Boolean);

  const contadorDireita: Column = {
    width: "*",
    alignment: "right",
    stack: [
      ...(e.contador_nome ? [{ text: e.contador_nome.toUpperCase(), fontSize: 10.5, color: TEXTO, characterSpacing: 0.4 }] : []),
      ...(e.contador_crc ? [{ text: `Contador  |  ${e.contador_crc.replace(/^CRC\s*/i, "CRC ")}`, fontSize: 9.5, color: TEXTO, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
      ...(e.cidade ? [{ text: `${e.cidade}${e.uf ? ` – ${nomeEstado(e.uf)}` : ""}`, fontSize: 9.5, color: CINZA, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
    ],
    margin: [0, 14, 0, 0],
  };
  const logo: Content = r.logo ? { image: r.logo.dados, fit: [120, 62] } : { svg: logoVerticalSvg(ESCURO), width: 96 };

  const celulaRotulo = (t: string) => ({ text: t, bold: true, fillColor: FUNDO_ROTULO, margin: [6, 7, 6, 7] as [number, number, number, number] });
  const celulaValor = (titulo: string, sub: string | null) => ({
    stack: [{ text: titulo, bold: true }, ...(sub ? [{ text: sub, fontSize: 9.5 }] : [])],
    margin: [6, 5, 6, 5] as [number, number, number, number],
  });

  const linhaRodape = [
    (e.nome_fantasia ?? e.razao_social).toUpperCase(),
    e.cidade ? `${e.cidade}${e.uf ? ` – ${e.uf}` : ""}` : null,
    e.contador_crc,
  ].filter((t): t is string => Boolean(t));

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [margem, 36, margem, 70],
    info: { title: `Recibo nº ${numeroRecibo(r)} — ${r.pagador.nome}`, author: e.nome_fantasia ?? e.razao_social, creator: "Portal Guarese's ON" },
    watermark: cancelado ? { text: "CANCELADO", opacity: 0.16, bold: true, fontSize: 96, color: "#b91c1c" } : undefined,
    background: () => [
      // Faixas do alto: escura e bege, separadas na diagonal
      { canvas: [
          { type: "polyline", closePath: true, points: [{ x: 0, y: 0 }, { x: 455, y: 0 }, { x: 443, y: 14 }, { x: 0, y: 14 }], color: ESCURO },
          { type: "polyline", closePath: true, points: [{ x: 461, y: 0 }, { x: largura, y: 0 }, { x: largura, y: 14 }, { x: 449, y: 14 }], color: AREIA },
        ], absolutePosition: { x: 0, y: 0 } },
      // Marca "ON" clarinha ao fundo
      { svg: simboloSvg("#f4f1ee"), width: 380, absolutePosition: { x: 175, y: 320 } },
      // Faixas do pé
      { canvas: [
          { type: "polyline", closePath: true, points: [{ x: 0, y: altura - 14 }, { x: 150, y: altura - 14 }, { x: 138, y: altura }, { x: 0, y: altura }], color: AREIA },
          { type: "polyline", closePath: true, points: [{ x: 156, y: altura - 14 }, { x: largura, y: altura - 14 }, { x: largura, y: altura }, { x: 144, y: altura }], color: ESCURO },
        ], absolutePosition: { x: 0, y: 0 } },
    ],
    footer: () => ({
      margin: [margem, 14, margem, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: util, y2: 0, lineWidth: 0.5, lineColor: LINHA }] },
        {
          text: linhaRodape.flatMap((t, i) => (i ? [{ text: "   •   ", color: CINZA }, { text: t }] : [{ text: t, bold: i === 0 }])),
          alignment: "center",
          fontSize: 7.5,
          color: TEXTO,
          margin: [0, 8, 0, 0],
        },
      ],
    }),
    defaultStyle: { font: "Helvetica", fontSize: 10.5, lineHeight: 1.25, color: TEXTO },
    content: [
      // Cabeçalho: logo e contador, com a linha terminando em seta
      { columns: [{ width: "auto", stack: [logo] }, contadorDireita], margin: [0, 6, 0, 0] },
      {
        canvas: [
          { type: "line", x1: 0, y1: 10, x2: util - 50, y2: 10, lineWidth: 1.4, lineColor: ESCURO },
          { type: "line", x1: util - 50, y1: 10, x2: util - 8, y2: -4, lineWidth: 1.4, lineColor: ESCURO },
          { type: "polyline", closePath: true, points: [{ x: util - 14, y: -8 }, { x: util + 2, y: -9 }, { x: util - 6, y: 3 }], color: ESCURO },
        ],
        margin: [0, 6, 0, 0],
      },
      // Dados do escritório
      {
        stack: [
          { text: e.razao_social.toUpperCase(), bold: true, fontSize: 11 },
          { text: [e.nome_fantasia ? `Nome fantasia: ${e.nome_fantasia}  |  ` : "", `CNPJ: ${formatarDocumento(e.cnpj)}`].join(""), fontSize: 8.5, color: CINZA },
          ...(e.endereco ? [{ text: `${e.endereco}${e.cep ? ` - CEP: ${formatarCep(e.cep)}` : ""}`, fontSize: 8.5, color: CINZA }] : []),
          ...(e.telefone || e.email
            ? [{ text: [e.telefone ? `Fone: ${formatarTelefone(e.telefone)}` : null, e.email ? `E-mail: ${e.email}` : null].filter(Boolean).join("  |  "), fontSize: 8.5, color: CINZA }]
            : []),
        ],
        alignment: "center",
        lineHeight: 1.1,
        margin: [0, 26, 0, 0],
      },
      { text: `RECIBO Nº ${numeroRecibo(r)}`, alignment: "center", bold: true, fontSize: 20, margin: [0, 26, 0, 0] },
      { text: `VALOR: ${formatarMoeda(r.valor)}`, alignment: "center", bold: true, fontSize: 13, margin: [0, 4, 0, 0] },
      {
        margin: [0, 18, 0, 0],
        table: {
          widths: [150, "*"],
          body: [
            [celulaRotulo("Recebedor"), celulaValor(e.razao_social.toUpperCase(), `CNPJ: ${formatarDocumento(e.cnpj)}`)],
            [celulaRotulo("Pagador"), celulaValor(r.pagador.nome.toUpperCase(), documentoTexto(r.pagador.documento))],
            [celulaRotulo("Referência"), celulaValor(r.referencia, r.competencia ? `Competência: ${competenciaTexto(r.competencia, false)}` : null)],
          ],
        },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => LINHA, vLineColor: () => LINHA },
      },
      {
        text: [
          "Recebemos de ",
          { text: r.pagador.nome.toUpperCase(), bold: true },
          r.pagador.documento ? `, inscrito no ${r.pagador.documento.length === 11 ? "CPF" : "CNPJ"} sob nº ${formatarDocumento(r.pagador.documento)}` : "",
          ", a importância de ",
          { text: `${formatarMoeda(r.valor)} (${valorPorExtenso(r.valor)})`, bold: true },
          `, referente ao ${referenciaTexto}`,
          extras.length ? `, ${extras.join(", ")}` : "",
          ".",
        ],
        lineHeight: 1.6,
        margin: [0, 22, 0, 0],
      },
      { text: "E, para maior clareza e validade, firmamos o presente recibo.", lineHeight: 1.6, margin: [0, 8, 0, 0] },
      { text: `${r.cidade}${r.uf ? `/${r.uf}` : ""}, ${dataPorExtenso(r.data)}.`, alignment: "right", margin: [0, 22, 0, 0] },
      {
        unbreakable: true,
        alignment: "center",
        margin: [0, 56, 0, 0],
        stack: [
          {
            columns: [
              { width: "*", text: "" },
              { width: 240, canvas: [{ type: "line", x1: 0, y1: 0, x2: 240, y2: 0, lineWidth: 0.6, lineColor: TEXTO }] },
              { width: "*", text: "" },
            ],
          },
          { text: e.razao_social.toUpperCase(), bold: true, margin: [0, 4, 0, 0] },
          { text: `CNPJ: ${formatarDocumento(e.cnpj)}`, fontSize: 9.5 },
          ...(r.assinatura && !cancelado
            ? [
                {
                  text: [
                    { text: "Assinado digitalmente", bold: true },
                    ` por ${r.assinatura.titular} (${r.assinatura.documento.length === 11 ? "CPF" : "CNPJ"} ${formatarDocumento(r.assinatura.documento)}) em ${dataHoraBrasilia(r.assinatura.data)}, com certificado ICP-Brasil. Confira em validar.iti.gov.br.`,
                  ],
                  fontSize: 7.5,
                  color: CINZA,
                  margin: [40, 8, 40, 0] as [number, number, number, number],
                },
              ]
            : []),
        ],
      },
      ...(r.observacao ? [{ text: r.observacao, fontSize: 8.5, color: CINZA, alignment: "center", margin: [0, 26, 0, 0] } as Content] : []),
      {
        text: "Documento emitido para comprovação de recebimento de honorários contábeis.",
        fontSize: 7.5,
        color: CINZA,
        alignment: "center",
        margin: [0, r.observacao ? 6 : 34, 0, 0],
      },
      ...(cancelado
        ? [{ text: `Recibo cancelado${r.motivoCancelamento ? `: ${r.motivoCancelamento}` : ""}.`, fontSize: 9, bold: true, color: "#b91c1c", alignment: "center", margin: [0, 10, 0, 0] } as Content]
        : []),
    ],
  };
  return pm.createPdf(doc).getBuffer();
}

/** "17/11/2026 às 17:00" no horário de Brasília. */
function dataHoraBrasilia(d: Date) {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} às ${v("hour")}:${v("minute")}`;
}

const ESTADOS: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco",
  PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
function nomeEstado(uf: string) {
  return ESTADOS[uf.toUpperCase()] ?? uf;
}
