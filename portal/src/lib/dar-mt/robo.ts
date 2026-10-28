import { dec, type ValorEntrada } from "@/lib/dinheiro";

/**
 * Robô do DAR-1/AUT da SEFAZ-MT (Emissão de DAR → Pessoa Jurídica Inscrita).
 *
 * O site é público (sem login, certificado ou captcha): o robô faz o mesmo
 * caminho de uma pessoa no navegador, com os mesmos campos:
 *
 *  1. abre o formulário pela inscrição estadual (pj/gerardar);
 *  2. confere que a receita existe para o período (tributodropdown);
 *  3. emite o DAR com valor, multa (dias de atraso) e juros (pj/gerardar,
 *     pagn=emitir) — a SEFAZ registra o DAR e devolve o número e o total;
 *  4. baixa o PDF oficial, com o código de barras da SEFAZ (formapagamento).
 *
 * Se uma página vier diferente do esperado (site mudou, fora do ar, captcha),
 * o robô para com a mensagem e nada é anexado: o caminho manual continua.
 */
export const BASE_DAR_MT = "https://www.sefaz.mt.gov.br/arrecadacao/darlivre";
const AGENTE = "Mozilla/5.0 (compatible; PortalGuaresesON/1.0)";

export interface PedidoDarMt {
  /** Inscrição estadual (só dígitos, 9). */
  inscricaoEstadual: string;
  /** Período de referência AAAA-MM. */
  periodo: string;
  receita: string;
  /** Vencimento do DAR (data limite do pagamento), AAAA-MM-DD. */
  vencimentoDar: string;
  principal: ValorEntrada;
  diasAtraso: number;
  multa: ValorEntrada;
  juros: ValorEntrada;
  /** "Informações previstas em instruções" (até 220 caracteres, sem acento). */
  informacao: string;
}

export interface FormularioDarMt {
  ocultos: Record<string, string>;
  contribuinte: string | null;
  dataAtual: string | null;
  ultimoDiaUtil: string | null;
}

export interface ResumoDarMt {
  numero: string;
  periodo: string | null;
  vencimento: string | null;
  principal: string | null;
  juros: string | null;
  total: string | null;
}

export interface DarEmitidoMt extends ResumoDarMt {
  pdf: Buffer;
  linhaDigitavel: string | null;
}

export class ErroDarMt extends Error {}

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

const LATIN1 = new TextDecoder("latin1");

function textoVisivel(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&([a-z])(acute|grave|circ|tilde|cedil);/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1.234,56" → "1234.56" */
function valorBr(v: string | undefined): string | null {
  return v ? v.replace(/\./g, "").replace(",", ".") : null;
}

/** 1234.5 → "1.234,50" (máscara do formulário) */
export function valorParaSefaz(v: ValorEntrada): string {
  const [int, frac] = dec(v).toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

function dataParaSefaz(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function formatarIeMt(ie: string): string {
  const d = ie.replace(/\D/g, "");
  return d.length === 9 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}-${d.slice(8)}` : d;
}

/** Texto aceito no campo livre: maiúsculas sem acento, até 220 caracteres. */
export function informacaoSemAcento(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―]/g, "-")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 220);
}

export function lerFormulario(html: string): FormularioDarMt {
  const ocultos: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*type="hidden"[^>]*>/gi)) {
    const nome = /\bname="([^"]*)"/i.exec(m[0])?.[1];
    if (nome) ocultos[nome] = /\bvalue="([^"]*)"/i.exec(m[0])?.[1] ?? "";
  }
  const contribuinte = /Nome do contribuinte:\s*([^:]+?)\s+Endere/i.exec(textoVisivel(html))?.[1]?.trim() ?? null;
  const dataAtual = /var dataAtual = "(\d{2}\/\d{2}\/\d{4})"/.exec(html)?.[1] ?? null;
  const ultimoDiaUtil = /ultimoDiaUtil = "(\d{2}\/\d{2}\/\d{4})"/.exec(html)?.[1] ?? null;
  return { ocultos, contribuinte, dataAtual, ultimoDiaUtil };
}

export function lerReceitas(html: string): string[] {
  return [...html.matchAll(/<option[^>]*value="?(\d+)"?/gi)].map((m) => m[1]);
}

export function lerResumo(html: string): ResumoDarMt | null {
  const numero = /name="numrDar"[^>]*value="(\d{6,20})"/i.exec(html)?.[1] ?? /id="numrDar"[^>]*value="(\d{6,20})"/i.exec(html)?.[1];
  if (!numero) return null;
  const t = textoVisivel(html);
  const valor = (rotulo: string) => valorBr(new RegExp(`${rotulo}:\\s*([\\d.]+,\\d{2})`, "i").exec(t)?.[1]);
  return {
    numero,
    periodo: /refer[eê]ncia:\s*(\d{2}\/\d{4})/i.exec(t)?.[1] ?? null,
    vencimento: /Data de vencimento:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] ?? null,
    principal: valor("Valor Tributo"),
    juros: valor("Valor Juros"),
    total: valor("Valor Total"),
  };
}

/** Mensagem que a SEFAZ mostrou numa página de erro (para repassar à equipe). */
export function mensagemDaPagina(html: string): string | null {
  const t = textoVisivel(html);
  const m = /(?:Mensagem|Erro|Aten[cç][aã]o)[:!\s]+(.{10,200}?)(?:©|$)/i.exec(t);
  return m ? m[1].trim() : null;
}

/** Linha digitável (48 dígitos em 4 blocos) no texto do PDF do DAR. */
export function linhaDigitavelDoTexto(texto: string): string | null {
  const m = /(8\d{10}-\d)\s+(\d{11}-\d)\s+(\d{11}-\d)\s+(\d{11}-\d)/.exec(texto);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : null;
}

async function textoDoPdf(pdf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** Sessão com cookies, como um navegador. */
class Sessao {
  private cookies = new Map<string, string>();
  constructor(private buscar: Buscar) {}

  async pedir(caminho: string, corpo: URLSearchParams | FormData | null, referer?: string): Promise<{ resp: Response; bytes: Buffer }> {
    const headers: Record<string, string> = { "User-Agent": AGENTE, Accept: "text/html,application/xhtml+xml,application/xml,application/pdf,*/*" };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (referer) headers.Referer = `${BASE_DAR_MT}/${referer}`;
    let resp: Response;
    try {
      resp = await this.buscar(`${BASE_DAR_MT}/${caminho}`, {
        method: corpo ? "POST" : "GET",
        headers,
        body: corpo ?? undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
    } catch {
      throw new ErroDarMt("O site da SEFAZ-MT não respondeu. Tente de novo em alguns minutos.");
    }
    for (const c of resp.headers.getSetCookie?.() ?? []) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    if (resp.status !== 200) throw new ErroDarMt(`O site da SEFAZ-MT respondeu de um jeito inesperado (HTTP ${resp.status}). Gere o DAR pelo site.`);
    return { resp, bytes: Buffer.from(await resp.arrayBuffer()) };
  }
}

/**
 * Emite o DAR na SEFAZ-MT e devolve o número, o resumo da SEFAZ e o PDF
 * oficial. `conferir` recebe o resumo antes do PDF: se o total da SEFAZ for
 * diferente do calculado, a emissão para ali.
 */
export async function emitirDarMt(pedido: PedidoDarMt, buscar: Buscar = fetch): Promise<DarEmitidoMt> {
  const s = new Sessao(buscar);
  const [ano, mes] = pedido.periodo.split("-");
  const periodo = `${mes}/${ano}`;

  await s.pedir("menudarlivre", null);
  const abertura = await s.pedir(
    "pj/gerardar",
    new URLSearchParams({ inscricaoEstadual: formatarIeMt(pedido.inscricaoEstadual), pagn: "formulario", codgOrgao: "", corona: "", tipoTributo: "", pjInscrita: "true", ipContribuinte: "", portaContribuinte: "" }),
    "menudarlivre",
  );
  const htmlForm = LATIN1.decode(abertura.bytes);
  const form = lerFormulario(htmlForm);
  if (form.ocultos.pagn !== "emitir" || !form.ocultos.numrInscEstadual) {
    const msg = mensagemDaPagina(htmlForm);
    throw new ErroDarMt(`A SEFAZ-MT não abriu o formulário do DAR para a inscrição ${formatarIeMt(pedido.inscricaoEstadual)}${msg ? `: ${msg}` : "."}`);
  }
  if (form.ocultos.numrInscEstadual.replace(/\D/g, "") !== pedido.inscricaoEstadual.replace(/\D/g, "")) {
    throw new ErroDarMt("A SEFAZ-MT devolveu outra inscrição estadual no formulário. Nada foi emitido.");
  }

  const receitas = await s.pedir(
    "tributodropdown",
    new URLSearchParams({
      codgOrgao: "",
      codgCnae: form.ocultos.codgCnae ?? "",
      codgLocalEmissao: "6",
      tipoContribuinte: form.ocultos.tipoContribuinte ?? "1",
      nome: "tributo",
      onChange: "javascript:eventoTributo(this.options[this.selectedIndex].value)",
      periodoReferencia: `01/${periodo}`,
      tipoTributo: "",
      corona: "",
      tipoNovoMenu: "",
    }),
    "pj/gerardar",
  );
  if (!lerReceitas(LATIN1.decode(receitas.bytes)).includes(pedido.receita)) {
    throw new ErroDarMt(`A receita ${pedido.receita} não aparece no DAR da SEFAZ-MT para ${periodo}. Gere pelo site.`);
  }
  const tributo = LATIN1.decode(
    (await s.pedir("tributodropdown", new URLSearchParams({ tributo: pedido.receita, periodoReferencia: `01/${periodo}`, tipoTributo: "", tipoNovoMenu: "" }), "pj/gerardar")).bytes,
  );
  const temMulta = !/<codg-tributo-multas>\s*0\s*</.test(tributo);
  const temJuros = !/<codg-tributo-juros>\s*0\s*</.test(tributo);
  if ((dec(pedido.multa).gt(0) && !temMulta) || (dec(pedido.juros).gt(0) && !temJuros)) {
    throw new ErroDarMt("O formulário da SEFAZ-MT não aceita multa ou juros nesta receita. Gere pelo site.");
  }

  // Emissão: os mesmos campos que o navegador envia (os desabilitados ficam de fora)
  const fd = new FormData();
  const campos: [string, string][] = [
    ["tipoVenda", "1"],
    ["periodoReferencia", periodo],
    ["tributo", pedido.receita],
    ["cnpjBeneficiario", ""],
    ["cpfPrestador", ""],
    ["cnpjPrestador", ""],
    ["idBeneficiario", ""],
    ["codgCNO", ""],
    ["codgProcesso", ""],
    ["numrDuimp", ""],
    ["codgNotificacao", ""],
    ["numrDocumentoDestinatario", ""],
    ["notas", "1"],
    ...Array.from({ length: 10 }, (_, i): [string, string] => [`nfeNota${i + 1}`, ""]),
    ["numrParcela", ""],
    ["totalParcela", ""],
    ["numrNai", ""],
    ["numrTad", ""],
    ["multaCovid", ""],
    ["numeroNob", ""],
    ["codgConvDesc", ""],
    ["dataVencimento", dataParaSefaz(pedido.vencimentoDar)],
    ["qtd", ""],
    ["qtdUnMedida", ""],
    ["valorUnitario", ""],
    ["valorCampo", valorParaSefaz(pedido.principal)],
    ["valorCorrecao", ""],
    ["diasAtraso", pedido.diasAtraso > 0 ? String(pedido.diasAtraso) : ""],
    ["juros", dec(pedido.juros).gt(0) ? valorParaSefaz(pedido.juros) : ""],
    ["tipoDocumento", "2"],
    ...Array.from({ length: 10 }, (_, i): [string, string] => [`nota${i + 1}`, ""]),
    ["informacaoPrevista", informacaoSemAcento(pedido.informacao)],
    ["informacaoPrevista2", ""],
    ...Object.entries(form.ocultos).filter(([k]) => !["valor", "valorMulta", "tributoTad", "upfmtFethab"].includes(k)),
    ["valor", valorParaSefaz(pedido.principal)],
    ["valorMulta", dec(pedido.multa).gt(0) ? valorParaSefaz(pedido.multa) : ""],
    ["tributoTad", pedido.receita],
    ["upfmtFethab", "0.0"],
  ];
  for (const [k, v] of campos) fd.append(k, v);
  const emissao = await s.pedir("pj/gerardar", fd, "pj/gerardar");
  const htmlResumo = LATIN1.decode(emissao.bytes);
  const resumo = lerResumo(htmlResumo);
  if (!resumo) {
    const msg = mensagemDaPagina(htmlResumo);
    throw new ErroDarMt(`A SEFAZ-MT não emitiu o DAR${msg ? `: ${msg}` : ". Gere pelo site e anexe o PDF."}`);
  }
  const esperado = dec(pedido.principal).plus(dec(pedido.multa)).plus(dec(pedido.juros));
  if (!resumo.total || !dec(resumo.total).eq(esperado.toDecimalPlaces(2))) {
    throw new ErroDarMt(
      `A SEFAZ-MT registrou o DAR ${resumo.numero} com total ${resumo.total ? `R$ ${valorParaSefaz(resumo.total)}` : "não identificado"}, diferente do calculado (R$ ${valorParaSefaz(esperado)}). O DAR não foi anexado: confira no site.`,
    );
  }

  const pdf = await s.pedir("formapagamento", new URLSearchParams({ pagn: "emitirDarPdf", parmEmissao: "0", codgLocalEmissao: "", numrDar: resumo.numero }), "pj/gerardar");
  if ((pdf.resp.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/pdf" || pdf.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new ErroDarMt(`O DAR ${resumo.numero} foi registrado, mas a SEFAZ-MT não entregou o PDF. Baixe pelo site e anexe.`);
  }
  let linhaDigitavel: string | null = null;
  try {
    const texto = await textoDoPdf(pdf.bytes);
    linhaDigitavel = linhaDigitavelDoTexto(texto);
    // O PDF precisa trazer o mesmo total e o número do DAR (no código de barras)
    if (!texto.includes(valorParaSefaz(esperado)) || !texto.replace(/\D/g, "").includes(resumo.numero)) {
      throw new ErroDarMt(`O PDF do DAR ${resumo.numero} não confere com o total calculado. Confira no site.`);
    }
  } catch (e) {
    if (e instanceof ErroDarMt) throw e;
  }
  return { ...resumo, pdf: pdf.bytes, linhaDigitavel };
}
