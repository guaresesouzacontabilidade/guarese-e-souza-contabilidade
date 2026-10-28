import "server-only";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { logoDoCliente, type ImagemEmbutida } from "@/lib/marca/logos-relatorio";
import { formatarCep, formatarDataHora, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import type { ContextoHotel } from "./contexto";
import { COR_PADRAO_DOCUMENTO, MODELOS_DOCUMENTO, type ModeloDocumento } from "./rotulos";

/**
 * Documentos entregues ao hóspede (ficha de registro, confirmação, extrato e
 * recibo) com a identidade do próprio hotel: só a logo do hotel, a cor e os
 * contatos escolhidos pelo gerente e, no rodapé, a razão social e o CNPJ.
 */

type Supa = ContextoHotel["supabase"];

export interface IdentidadeHotel {
  nome: string;
  razao: string;
  documento: string;
  endereco: string | null;
  contatos: string[];
  cadastur: string | null;
  logo: ImagemEmbutida | null;
  modelo: ModeloDocumento;
  cor: string;
}

const COR_VALIDA = /^#[0-9a-f]{6}$/i;

export function modeloValido(v: unknown): v is ModeloDocumento {
  return typeof v === "string" && Object.hasOwn(MODELOS_DOCUMENTO, v);
}

type EnderecoEmpresa = { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };

/** Endereço do cadastro da empresa numa linha ("Rua X, 10 — Centro — Porto Nacional/TO — CEP 77500-000"). */
export function enderecoDoCadastro(e: EnderecoEmpresa) {
  return [[e.logradouro, e.numero].filter(Boolean).join(", "), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join("/"), e.cep ? `CEP ${formatarCep(e.cep)}` : null]
    .filter(Boolean)
    .join(" — ");
}

/** Lê a identidade do hotel (configuração dos documentos, com o cadastro da empresa como reserva). */
export async function carregarIdentidadeHotel(supabase: Supa, empresaId: string, previa?: { modelo?: string | null; cor?: string | null }): Promise<IdentidadeHotel> {
  const [{ data: e }, { data: cfg }] = await Promise.all([
    supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, documento, logo_path, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("hotel_config")
      .select("doc_modelo, doc_cor, doc_nome, doc_endereco, doc_telefone, doc_whatsapp, doc_email, doc_site, doc_cadastur")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
  ]);
  const enderecoCadastro = e ? enderecoDoCadastro(e) : "";
  const telefone = cfg?.doc_telefone ?? (e?.telefone ? formatarTelefone(e.telefone) : null);
  const contatos = [
    telefone ? `Tel. ${telefone}` : null,
    cfg?.doc_whatsapp ? `WhatsApp ${cfg.doc_whatsapp}` : null,
    cfg?.doc_email ?? e?.email ?? null,
    cfg?.doc_site ?? null,
  ].filter((c): c is string => Boolean(c));
  const modelo = modeloValido(previa?.modelo) ? previa.modelo : modeloValido(cfg?.doc_modelo) ? cfg.doc_modelo : "classico";
  const cor = previa?.cor && COR_VALIDA.test(previa.cor) ? previa.cor.toLowerCase() : cfg?.doc_cor && COR_VALIDA.test(cfg.doc_cor) ? cfg.doc_cor : COR_PADRAO_DOCUMENTO;
  return {
    nome: cfg?.doc_nome ?? e?.nome_fantasia ?? e?.razao_social ?? "Hotel",
    razao: e?.razao_social ?? "",
    documento: e ? formatarDocumento(e.documento) : "",
    endereco: cfg?.doc_endereco ?? (enderecoCadastro || null),
    contatos,
    cadastur: cfg?.doc_cadastur ?? null,
    logo: await logoDoCliente(supabase, e?.logo_path),
    modelo,
    cor,
  };
}

// ------------------------------------------------------------------ cores
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: number[]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mistura a cor com outra (t = 0 → a própria cor; t = 1 → a outra). */
function misturar(cor: string, com: string, t: number) {
  const a = rgb(cor);
  const b = rgb(com);
  return hex(a.map((v, i) => v + (b[i] - v) * t));
}

/** Luminância relativa (0 = preto, 1 = branco). */
export function luminancia(cor: string) {
  const [r, g, b] = rgb(cor).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Cores do documento: o destaque (faixa, títulos, cabeçalho das tabelas) e os tons de apoio. */
export interface PaletaDocumento {
  /** Fundo da faixa e do cabeçalho das tabelas. */
  destaque: string;
  /** Texto sobre o destaque (branco ou escuro, o que tiver mais contraste). */
  sobreDestaque: string;
  /** Títulos sobre o papel branco (escurecido quando a cor é clara demais). */
  titulo: string;
  linha: string;
  zebra: string;
  cinza: string;
  alerta: string;
}

export function paletaDe(modelo: ModeloDocumento, cor: string): PaletaDocumento {
  if (modelo === "economico") return { destaque: "#e6e6e6", sobreDestaque: "#111111", titulo: "#111111", linha: "#c8c8c8", zebra: "#f6f6f6", cinza: "#555555", alerta: "#111111" };
  const clara = luminancia(cor) > 0.45;
  return {
    destaque: cor,
    sobreDestaque: clara ? "#1a1a1a" : "#ffffff",
    titulo: clara ? misturar(cor, "#000000", 0.5) : cor,
    linha: misturar(cor, "#ffffff", 0.75),
    zebra: misturar(cor, "#ffffff", 0.94),
    cinza: "#5f5f5f",
    alerta: "#b91c1c",
  };
}

// ------------------------------------------------------------------ PDF
const LARGURA_A4 = 595.28;
const ALTURA_A4 = 841.89;

function cabecalhoClassico(id: IdentidadeHotel, p: PaletaDocumento): Content {
  return {
    margin: [40, 22, 40, 0],
    stack: [
      {
        columns: [
          id.logo
            ? ({ width: "auto", stack: [{ image: id.logo.dados, fit: [150, 54] }] } as Content)
            : ({ text: id.nome, bold: true, fontSize: 18, color: p.titulo, width: "*", margin: [0, 10, 0, 0] } as Content),
          {
            width: "*",
            alignment: "right",
            stack: [
              ...(id.logo ? [{ text: id.nome, bold: true, fontSize: 11, color: p.titulo } as Content] : []),
              ...(id.endereco ? [{ text: id.endereco, fontSize: 7.5, color: p.cinza } as Content] : []),
              ...(id.contatos.length ? [{ text: id.contatos.join("  ·  "), fontSize: 7.5, color: p.cinza } as Content] : []),
            ],
          } as Content,
        ],
        columnGap: 16,
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA_A4 - 80, y2: 0, lineWidth: 2, lineColor: p.destaque }], margin: [0, 8, 0, 0] },
    ],
  };
}

function cabecalhoFaixa(id: IdentidadeHotel, p: PaletaDocumento): Content {
  return {
    margin: [40, 18, 40, 0],
    columns: [
      ...(id.logo
        ? [
            {
              width: "auto",
              table: { body: [[{ image: id.logo.dados, fit: [116, 48], margin: [6, 5, 6, 5] }]] },
              layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => "#ffffff", paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
            } as Content,
          ]
        : []),
      {
        width: "*",
        margin: [0, id.logo ? 4 : 8, 0, 0],
        stack: [
          { text: id.nome, bold: true, fontSize: id.logo ? 15 : 19, color: p.sobreDestaque },
          ...(id.endereco ? [{ text: id.endereco, fontSize: 7.5, color: p.sobreDestaque, opacity: 0.9 } as Content] : []),
          ...(id.contatos.length ? [{ text: id.contatos.join("  ·  "), fontSize: 7.5, color: p.sobreDestaque, opacity: 0.9 } as Content] : []),
        ],
      },
    ],
    columnGap: 14,
  };
}

function cabecalhoEconomico(id: IdentidadeHotel, p: PaletaDocumento): Content {
  return {
    margin: [40, 20, 40, 0],
    stack: [
      ...(id.logo ? [{ image: id.logo.dados, fit: [130, 44], alignment: "center" } as Content] : []),
      { text: id.nome, bold: true, fontSize: id.logo ? 10.5 : 16, alignment: "center", color: p.titulo, margin: [0, id.logo ? 3 : 6, 0, 0] },
      { text: [id.endereco, id.contatos.join("  ·  ")].filter(Boolean).join("\n"), fontSize: 7.5, alignment: "center", color: p.cinza },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA_A4 - 80, y2: 0, lineWidth: 0.6, lineColor: "#444444" }], margin: [0, 6, 0, 0] },
    ],
  };
}

/** Altura reservada para o cabeçalho de cada modelo (o conteúdo começa abaixo dele). */
const TOPO: Record<ModeloDocumento, number> = { classico: 104, faixa: 116, economico: 118 };

export async function gerarDocumentoHotel(
  id: IdentidadeHotel,
  dados: { titulo: string; subtitulo: string; notaFinal?: string | null; geradoEm?: string },
  conteudo: Content[],
): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const p = paletaDe(id.modelo, id.cor);
  const economico = id.modelo === "economico";
  const rodape = [id.razao, id.documento ? `CNPJ ${id.documento}` : null, id.cadastur ? `Cadastur ${id.cadastur}` : null].filter(Boolean).join("  ·  ");
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, TOPO[id.modelo], 40, 54],
    info: { title: `${dados.titulo} — ${id.nome}`, author: id.nome, creator: id.nome },
    background:
      id.modelo === "faixa"
        ? () => ({
            canvas: [
              { type: "rect", x: 0, y: 0, w: LARGURA_A4, h: 92, color: p.destaque },
              { type: "rect", x: 0, y: ALTURA_A4 - 6, w: LARGURA_A4, h: 6, color: p.destaque },
            ],
          })
        : undefined,
    header: () => (id.modelo === "faixa" ? cabecalhoFaixa(id, p) : economico ? cabecalhoEconomico(id, p) : cabecalhoClassico(id, p)),
    footer: (pagina: number, total: number) => ({
      margin: [40, 10, 40, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA_A4 - 80, y2: 0, lineWidth: 0.4, lineColor: economico ? "#999999" : p.linha }] },
        {
          margin: [0, 5, 0, 0],
          columns: [
            { text: rodape, fontSize: 7, color: p.cinza },
            { text: `Página ${pagina} de ${total}`, alignment: "right", fontSize: 7, color: p.cinza, width: 70 },
          ],
        },
      ],
    }),
    defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.2, color: "#222222" },
    styles: {
      titulo: { fontSize: economico ? 14 : 16, bold: true, color: p.titulo, alignment: economico ? "center" : "left", characterSpacing: economico ? 0.6 : 0 },
      subtitulo: { fontSize: 9.5, color: p.cinza, alignment: economico ? "center" : "left" },
      secao: economico
        ? { fontSize: 10, bold: true, color: "#111111", margin: [0, 12, 0, 5], decoration: "underline" }
        : { fontSize: 11, bold: true, color: p.titulo, margin: [0, 13, 0, 5] },
      cabecalhoTabela: { bold: true, fontSize: 8, color: p.sobreDestaque, fillColor: p.destaque },
      nota: { fontSize: 7.5, color: p.cinza, italics: true },
    },
    content: [
      { text: economico ? dados.titulo.toUpperCase() : dados.titulo, style: "titulo" },
      { text: dados.subtitulo, style: "subtitulo", margin: [0, 2, 0, 2] },
      { text: `Emitido em ${formatarDataHora(dados.geradoEm ?? new Date().toISOString())}`, fontSize: 7.5, color: p.cinza, alignment: economico ? "center" : "left", margin: [0, 0, 0, 6] },
      ...conteudo,
      ...(dados.notaFinal ? [{ text: dados.notaFinal, style: "nota", margin: [0, 16, 0, 0] } as Content] : []),
    ],
  };
  return pm.createPdf(doc).getBuffer();
}
