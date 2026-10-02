import "server-only";
import { join } from "node:path";
import type { Content, ContentTable, TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarData, formatarDataHora } from "@/lib/formatos";
import type { ResultadoDre } from "./dre";
import { GRUPOS_FLUXO, type Projecao, type ResultadoFluxo } from "./fluxo";
import type { Indicador } from "./indicadores";
import { rotuloMesCurto } from "./periodo";

/**
 * Geração de PDFs no servidor (pdfmake). Sem acesso a URLs externas: a logo
 * enviada pelo escritório é lida antes e embutida como imagem.
 */
const COR = { marrom: "#4a2c1d", bege: "#f1e8dc", begeForte: "#e6d6c2", cinza: "#6b625b", verde: "#15803d", vermelho: "#b91c1c", amarelo: "#a16207" };

const SIMBOLO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4a2c1d"/><circle cx="22" cy="36" r="11" fill="none" stroke="#f1e8dc" stroke-width="5"/><path d="M38 47V25l12 16V25" fill="none" stroke="#f1e8dc" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M50 8l7 8h-4.5v6h-5v-6H43z" fill="#d9b892"/></svg>`;

export interface Cabecalho {
  titulo: string;
  subtitulo: string;
  empresa: { nome: string; documento: string };
  escritorio: { nome: string; razao: string; cnpj: string; email: string | null; endereco: string };
  logo?: { dados: string } | null; // data URL (png/jpeg) da logo enviada
  situacao: "preliminar" | "revisado" | "rascunho";
  geradoEm: string;
  observacao?: string;
}

async function pdfmake() {
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
  return pm;
}
interface PdfMake {
  setFonts(f: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(fn: (url: string) => boolean): void;
  createPdf(doc: TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
}

export async function gerarPdf(cab: Cabecalho, conteudo: Content[]): Promise<Buffer> {
  const pm = await pdfmake();
  const marca: Content = cab.logo
    ? { image: cab.logo.dados, fit: [140, 40] }
    : { columns: [{ svg: SIMBOLO, width: 30 }, { stack: [{ text: cab.escritorio.nome, bold: true, color: COR.marrom, fontSize: 11 }, { text: "Contabilidade", fontSize: 7, color: COR.cinza }], margin: [6, 3, 0, 0] }], columnGap: 0 };
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 78, 40, 56],
    info: { title: `${cab.titulo} — ${cab.empresa.nome}`, author: cab.escritorio.nome, creator: "Portal Guarese's ON" },
    watermark: cab.situacao === "revisado" ? undefined : { text: cab.situacao === "rascunho" ? "RASCUNHO" : "PRELIMINAR", opacity: 0.06, bold: true, fontSize: 80 },
    header: () => ({
      margin: [40, 22, 40, 0],
      columns: [
        { width: "*", stack: [marca] },
        {
          width: "auto",
          alignment: "right",
          stack: [
            { text: cab.empresa.nome, bold: true, fontSize: 9, color: COR.marrom },
            { text: cab.empresa.documento, fontSize: 8, color: COR.cinza },
          ],
        },
      ],
    }),
    footer: (pagina: number, total: number) => ({
      margin: [40, 12, 40, 0],
      columns: [
        {
          text: `${cab.escritorio.razao} — CNPJ ${formatarCnpj(cab.escritorio.cnpj)} — ${cab.escritorio.endereco}${cab.escritorio.email ? ` — ${cab.escritorio.email}` : ""}`,
          fontSize: 6.5,
          color: COR.cinza,
        },
        { text: `Página ${pagina} de ${total}`, alignment: "right", fontSize: 7, color: COR.cinza, width: 70 },
      ],
    }),
    defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.2, color: "#2b211b" },
    styles: {
      titulo: { fontSize: 17, bold: true, color: COR.marrom },
      subtitulo: { fontSize: 10, color: COR.cinza },
      secao: { fontSize: 12, bold: true, color: COR.marrom, margin: [0, 14, 0, 6] },
      cabecalhoTabela: { bold: true, fontSize: 8, color: "#ffffff", fillColor: COR.marrom },
      nota: { fontSize: 7.5, color: COR.cinza, italics: true },
    },
    content: [
      { text: cab.titulo, style: "titulo" },
      { text: cab.subtitulo, style: "subtitulo", margin: [0, 2, 0, 4] },
      {
        text: [
          { text: cab.situacao === "revisado" ? "Revisado pelo escritório" : cab.situacao === "rascunho" ? "Rascunho — não publicado" : "Preliminar — os números ainda podem mudar", bold: true, color: cab.situacao === "revisado" ? COR.verde : COR.amarelo },
          { text: ` · Gerado em ${formatarDataHora(cab.geradoEm)}`, color: COR.cinza },
        ],
        fontSize: 8,
        margin: [0, 0, 0, 8],
      },
      ...(cab.observacao ? [{ text: cab.observacao, style: "nota", margin: [0, 0, 0, 6] } as Content] : []),
      ...conteudo,
      {
        text: "Relatório gerencial elaborado com base nas informações e documentos enviados pela empresa e registrados no Portal Guarese's ON. Não substitui as demonstrações contábeis oficiais.",
        style: "nota",
        margin: [0, 18, 0, 0],
      },
    ],
  };
  return pm.createPdf(doc).getBuffer();
}

// ------------------------------------------------------------------ blocos
const moeda = (v: string | number | null | undefined, sinal = false): TableCell => {
  const d = dec(v ?? 0);
  return { text: d.isZero() ? "—" : formatarMoeda(d), alignment: "right", color: sinal && d.isNegative() ? COR.vermelho : undefined, noWrap: true };
};

function tabela(
  cabecalho: string[],
  linhas: TableCell[][],
  larguras: (string | number)[],
  opcoes: { destaques?: number[]; fontSize?: number; esquerda?: number[] } = {},
): ContentTable {
  const esquerda = new Set([0, ...(opcoes.esquerda ?? [])]);
  return {
    table: {
      headerRows: 1,
      widths: larguras,
      body: [
        cabecalho.map((c, i) => ({ text: c, style: "cabecalhoTabela", alignment: esquerda.has(i) ? "left" : "right" }) as TableCell),
        ...linhas,
      ],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 || i === 1 ? 0 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => COR.begeForte,
      paddingTop: () => 3,
      paddingBottom: () => 3,
      fillColor: (i: number) => (opcoes.destaques?.includes(i) ? COR.bege : null),
    },
    fontSize: opcoes.fontSize ?? 8.5,
  } as ContentTable;
}

export function blocoDre(dre: ResultadoDre, rotuloPeriodo: string): Content[] {
  const varios = dre.meses.length > 1 && dre.meses.length <= 6;
  const cab = ["Descrição", ...(varios ? dre.meses.map(rotuloMesCurto) : []), varios ? "Total" : rotuloPeriodo, "% receita"];
  const destaques: number[] = [];
  const linhas = dre.linhas.map((l, i) => {
    if (l.tipo === "total") destaques.push(i + 1);
    const negrito = l.tipo !== "categoria";
    return [
      { text: l.rotulo, bold: negrito, margin: [l.nivel === 1 ? 10 : 0, 0, 0, 0], fontSize: l.nivel === 1 ? 8 : undefined } as TableCell,
      ...(varios ? dre.meses.map((m) => ({ ...(moeda(l.valores[m], true) as object), bold: negrito }) as TableCell) : []),
      { ...(moeda(l.total, true) as object), bold: true } as TableCell,
      { text: l.percentual === null ? "" : `${l.percentual.toFixed(1).replace(".", ",")}%`, alignment: "right", color: COR.cinza } as TableCell,
    ];
  });
  return [
    { text: "Resultado do período (DRE gerencial)", style: "secao" },
    tabela(cab, linhas, ["*", ...(varios ? dre.meses.map(() => "auto") : []), "auto", 42], { destaques, fontSize: varios && dre.meses.length > 3 ? 7.5 : 8.5 }),
    { text: "Pela competência. Juros, multas, descontos e taxas de pagamentos entram no mês do pagamento.", style: "nota", margin: [0, 4, 0, 0] },
  ];
}

export function blocoFluxo(fluxo: ResultadoFluxo): Content[] {
  const meses = fluxo.meses.slice(-6);
  const grupos = Object.keys(GRUPOS_FLUXO).filter((g) => meses.some((m) => m.porGrupo[g]));
  const linhas: TableCell[][] = [
    [{ text: "Saldo no início", bold: true }, ...meses.map((m) => ({ ...(moeda(m.saldoInicial, true) as object), bold: true }) as TableCell)],
  ];
  for (const g of grupos) {
    if (meses.some((m) => !dec(m.porGrupo[g]?.entradas ?? 0).isZero())) linhas.push([{ text: `${GRUPOS_FLUXO[g]} — entradas` }, ...meses.map((m) => moeda(m.porGrupo[g]?.entradas))]);
    if (meses.some((m) => !dec(m.porGrupo[g]?.saidas ?? 0).isZero())) linhas.push([{ text: `${GRUPOS_FLUXO[g]} — saídas` }, ...meses.map((m) => moeda(m.porGrupo[g]?.saidas))]);
  }
  if (meses.some((m) => !dec(m.abertura).isZero())) linhas.push([{ text: "Saldo inicial de contas cadastradas" }, ...meses.map((m) => moeda(m.abertura))]);
  linhas.push([{ text: "Saldo no fim", bold: true }, ...meses.map((m) => ({ ...(moeda(m.saldoFinal, true) as object), bold: true }) as TableCell)]);
  return [
    { text: "Fluxo de caixa realizado", style: "secao" },
    tabela(["Movimento", ...meses.map((m) => rotuloMesCurto(m.mes))], linhas, ["*", ...meses.map(() => "auto")], { destaques: [1, linhas.length] }),
    { text: "Contas que compõem o saldo disponível. Transferências entre essas contas não aparecem.", style: "nota", margin: [0, 4, 0, 0] },
  ];
}

export function blocoProjecao(p: Projecao, saldoHoje: string, proximas: { data: string; vencido: boolean; descricao: string; entrada: number | string; saida: number | string }[]): Content[] {
  const blocos: Content[] = [
    { text: "Previsão de caixa", style: "secao" },
    tabela(
      ["Horizonte", "A receber", "A pagar", "Saldo previsto"],
      [
        [{ text: "Hoje" }, moeda(0), moeda(0), moeda(saldoHoje, true)],
        ...p.janelas.map((j) => [{ text: `Próximos ${j.dias} dias` } as TableCell, moeda(j.entradas), moeda(j.saidas), moeda(j.saldo, true)]),
      ],
      ["*", "auto", "auto", "auto"],
    ),
  ];
  if (p.menorSaldo && dec(p.menorSaldo.valor).isNegative()) {
    blocos.push({ text: `Atenção: o caixa pode ficar negativo em ${formatarData(p.menorSaldo.data)} (${formatarMoeda(p.menorSaldo.valor)}).`, color: COR.vermelho, bold: true, margin: [0, 6, 0, 0] });
  }
  if (proximas.length) {
    blocos.push(
      { text: "Contas dos próximos 30 dias (inclui vencidas)", bold: true, margin: [0, 10, 0, 4] },
      tabela(
        ["Vencimento", "Descrição", "A receber", "A pagar"],
        proximas.slice(0, 40).map((l) => [
          { text: l.vencido ? "vencida" : formatarData(l.data), color: l.vencido ? COR.vermelho : undefined },
          { text: l.descricao },
          moeda(l.entrada),
          moeda(l.saida),
        ]),
        ["auto", "*", "auto", "auto"],
        { esquerda: [1] },
      ),
    );
  }
  return blocos;
}

export function blocoIndicadores(indicadores: Indicador[], resumo: string[]): Content[] {
  const cor = (s: Indicador["status"]) => (s === "bom" ? COR.verde : s === "atencao" ? COR.amarelo : s === "critico" ? COR.vermelho : COR.cinza);
  const rotulo = (s: Indicador["status"]) => (s === "bom" ? "Saudável" : s === "atencao" ? "Atenção" : s === "critico" ? "Crítico" : "Sem dados");
  return [
    ...(resumo.length ? ([{ text: "Resumo do período", style: "secao" }, { ul: resumo.map((t) => ({ text: t, margin: [0, 0, 0, 2] })), fontSize: 9 }] as Content[]) : []),
    { text: "Indicadores de saúde financeira", style: "secao" },
    {
      table: {
        widths: ["*", "auto", 62],
        body: indicadores.map((i) => [
          { stack: [{ text: i.titulo, bold: true }, { text: i.explicacao, fontSize: 7.5, color: COR.cinza }, ...(i.detalhe ? [{ text: i.detalhe, fontSize: 7.5, color: COR.cinza }] : [])] },
          { text: i.valor, bold: true, alignment: "right", noWrap: true },
          { text: rotulo(i.status), color: cor(i.status), bold: true, alignment: "right" },
        ]),
      },
      layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => COR.begeForte, paddingTop: () => 4, paddingBottom: () => 4 },
    } as ContentTable,
  ];
}

export function blocoTexto(titulo: string, texto: string | null | undefined): Content[] {
  if (!texto?.trim()) return [];
  return [{ text: titulo, style: "secao" }, ...texto.split(/\n{2,}/).map((p) => ({ text: p.trim(), margin: [0, 0, 0, 4] }) as Content)];
}

export function blocoLimitacoes(limitacoes: string[]): Content[] {
  if (!limitacoes.length) return [];
  return [
    { text: "Limitações dos dados deste relatório", style: "secao" },
    { ul: limitacoes.map((l) => ({ text: l, margin: [0, 0, 0, 2] })), fontSize: 8.5, color: COR.amarelo },
  ];
}
