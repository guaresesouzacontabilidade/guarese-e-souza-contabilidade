import "server-only";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { LOGO_ESCRITORIO_PNG } from "@/lib/marca/logo-png";
import { formatarDocumento } from "@/lib/formatos";
import { rotuloClausula, type Clausula } from "./contrato";

/**
 * PDF do contrato (ou aditivo/distrato) com o timbre do escritório. A via
 * final traz, no fim, o registro das assinaturas: o resumo SHA-256 do
 * arquivo que o cliente leu, a assinatura digital do escritório e o aceite
 * eletrônico do cliente (nome, CPF, e-mail, data e hora, IP e navegador).
 */

export interface RegistroAssinaturas {
  hashEnvio: string;
  escritorio: { titular: string; documento: string; data: string } | null;
  cliente: { nome: string; cpf: string; email: string | null; data: string; ip: string | null; navegador: string | null; metodo: string };
}

export interface ContratoPdf {
  numero: string;
  titulo: string;
  escritorio: { nome: string; razao_social: string; cnpj: string; endereco: string | null; contato: string | null };
  preambulo: string[];
  clausulas: Clausula[];
  /** "Porto Nacional/TO, 24 de novembro de 2026." */
  localData: string;
  assinaturas: { contratada: string; contratante: string };
  registro?: RegistroAssinaturas;
}

const ESCURO = "#07461f"; // verde da Catarinense
const AREIA = "#8e1018"; // vermelho da Catarinense (faixas)
const LINHA_TABELA = "#c9d4cc";
const TEXTO = "#2b2522";
const CINZA = "#6f6862";

export async function gerarPdfContrato(c: ContratoPdf): Promise<Buffer> {
  const pm = await carregarPdfMake();
  // Primeiro parágrafo sem número; os seguintes viram § 1º, § 2º...; itens "a)" e "1." ficam recuados
  const item = (p: string) => /^[a-z]\)|^\d+\./.test(p);
  const clausulas: Content[] = c.clausulas.flatMap((cl, i) => {
    let paragrafo = 0;
    return [
      { text: rotuloClausula(i, cl.titulo), bold: true, fontSize: 10.5, color: ESCURO, margin: [0, 12, 0, 4] as [number, number, number, number] },
      ...cl.paragrafos.map((p, j) => {
        const numerado = j > 0 && !item(p) && cl.paragrafos.filter((x) => !item(x)).length > 1;
        if (numerado) paragrafo += 1;
        return {
          text: numerado ? `§ ${paragrafo}º ${p}` : p,
          margin: [item(p) ? 14 : 0, 0, 0, 4] as [number, number, number, number],
          alignment: "justify" as const,
        };
      }),
    ];
  });

  const registro: Content[] = c.registro
    ? [
        { text: "REGISTRO DAS ASSINATURAS", bold: true, fontSize: 13, color: ESCURO, pageBreak: "before", margin: [0, 0, 0, 10] },
        { text: `${c.titulo} nº ${c.numero}`, margin: [0, 0, 0, 6] },
        { text: "Resumo SHA-256 do arquivo lido e aceito pelo cliente:", fontSize: 9, color: CINZA },
        { text: c.registro.hashEnvio, fontSize: 8.5, margin: [0, 2, 0, 12] },
        {
          table: {
            widths: [110, "*"],
            body: [
              [{ text: "CONTRATADA", bold: true, colSpan: 2, fillColor: "#eef4ef" }, {}],
              c.registro.escritorio
                ? ["Assinatura", `Digital, com certificado ICP-Brasil de ${c.registro.escritorio.titular} (${formatarDocumento(c.registro.escritorio.documento)}), em ${c.registro.escritorio.data}. Confira em validar.iti.gov.br.`]
                : ["Assinatura", "Emissão pelo escritório, sem certificado digital cadastrado no portal."],
              [{ text: "CONTRATANTE", bold: true, colSpan: 2, fillColor: "#eef4ef" }, {}],
              ["Nome", c.registro.cliente.nome],
              ["CPF", formatarDocumento(c.registro.cliente.cpf)],
              ["E-mail do portal", c.registro.cliente.email ?? "—"],
              ["Data e hora", c.registro.cliente.data],
              ["Confirmação", c.registro.cliente.metodo === "codigo_email" ? "Acesso ao portal com senha e código de 6 números enviado ao e-mail" : "Acesso ao portal com senha (sessão autenticada)"],
              ["IP", c.registro.cliente.ip ?? "—"],
              ["Navegador", c.registro.cliente.navegador ?? "—"],
            ],
          },
          layout: { hLineColor: () => LINHA_TABELA, vLineColor: () => LINHA_TABELA, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 5, paddingBottom: () => 5 },
          fontSize: 9.5,
        },
        {
          text: "As partes reconhecem a validade da assinatura eletrônica deste documento, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.",
          fontSize: 9,
          color: CINZA,
          margin: [0, 12, 0, 0],
        },
      ]
    : [];

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [56, 56, 56, 56],
    info: { title: `${c.titulo} nº ${c.numero}`, author: c.escritorio.nome },
    defaultStyle: { font: "Roboto", fontSize: 10, color: TEXTO, lineHeight: 1.25 },
    background: () => ({ canvas: [{ type: "rect", x: 0, y: 0, w: 595.28, h: 8, color: ESCURO }, { type: "rect", x: 0, y: 8, w: 595.28, h: 3, color: AREIA }] }),
    footer: (pagina: number, total: number) => ({
      margin: [56, 20, 56, 0],
      columns: [
        { text: `${c.titulo} nº ${c.numero}`, fontSize: 8, color: CINZA },
        { text: `Página ${pagina} de ${total}`, fontSize: 8, color: CINZA, alignment: "right" },
      ],
    }),
    content: [
      {
        columns: [
          { image: LOGO_ESCRITORIO_PNG, fit: [84, 50] },
          {
            width: "*",
            margin: [12, 4, 0, 0],
            stack: [
              { text: c.escritorio.nome.toUpperCase(), bold: true, fontSize: 11, color: ESCURO },
              { text: `${c.escritorio.razao_social} — CNPJ ${formatarDocumento(c.escritorio.cnpj)}`, fontSize: 8.5, color: CINZA },
              ...(c.escritorio.endereco ? [{ text: c.escritorio.endereco, fontSize: 8.5, color: CINZA }] : []),
              ...(c.escritorio.contato ? [{ text: c.escritorio.contato, fontSize: 8.5, color: CINZA }] : []),
            ],
          },
        ],
      },
      { text: c.titulo.toUpperCase(), bold: true, fontSize: 13, color: ESCURO, alignment: "center", margin: [0, 22, 0, 2] },
      { text: `nº ${c.numero}`, alignment: "center", color: CINZA, margin: [0, 0, 0, 14] },
      ...c.preambulo.map((p) => ({ text: p, alignment: "justify" as const, margin: [0, 0, 0, 6] as [number, number, number, number] })),
      { text: "As partes acima identificadas têm entre si justo e contratado o seguinte:", margin: [0, 4, 0, 0] },
      ...clausulas,
      { text: "E, por estarem de acordo, as partes assinam este instrumento eletronicamente.", margin: [0, 14, 0, 4] },
      { text: c.localData, margin: [0, 0, 0, 30] },
      {
        columns: [
          { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.6, lineColor: TEXTO }] }, { text: "CONTRATADA", bold: true, fontSize: 9, margin: [0, 4, 0, 0] }, { text: c.assinaturas.contratada, fontSize: 9 }] },
          { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.6, lineColor: TEXTO }] }, { text: "CONTRATANTE", bold: true, fontSize: 9, margin: [0, 4, 0, 0] }, { text: c.assinaturas.contratante, fontSize: 9 }] },
        ],
        columnGap: 30,
      },
      { text: "Assinado eletronicamente pelo portal. O registro das assinaturas acompanha a via final.", fontSize: 8, color: CINZA, margin: [0, 10, 0, 0] },
      ...registro,
    ],
  };
  return pm.createPdf(doc).getBuffer();
}
