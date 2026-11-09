import { dec, type ValorEntrada } from "@/lib/dinheiro";
import { atributos, decodificar, textoVisivel } from "./html";

/**
 * Robô do DARE avulso da SEFAZ-TO (sefaz.to.gov.br/dare), o mesmo caminho de
 * uma pessoa no navegador, sem login nem certificado (site público):
 *
 *  1. Identificação do contribuinte: informa o CNPJ e consulta;
 *  2. Seleção de inscrição estadual: escolhe a linha com a inscrição da empresa;
 *  3. Formulário do documento: município da receita, código da receita (105 —
 *     ICMS complementação de alíquota do Simples Nacional), vencimento (data
 *     de pagamento: dia 9), período de referência (MM/AAAA), valor e a
 *     observação dizendo do que se trata e a competência;
 *  4. "Atualizar Valores": confere que o total calculado pela SEFAZ é o valor
 *     da apuração (sem multa e juros); só então confirma;
 *  5. baixa o PDF oficial e confere valor, vencimento e inscrição no PDF.
 *
 * O sistema é feito em GeneXus: cada botão é um envio da página com o estado
 * (GXState) e o nome do evento. Se uma página vier diferente do esperado (site
 * mudou, fora do ar, empresa não encontrada), o robô para com a mensagem da
 * SEFAZ e nada é anexado.
 */
export const BASE_DARE_TO = "https://sefaz.to.gov.br/dare/servlet";
export const URL_DARE_AVULSO = `${BASE_DARE_TO}/hnetccwkda`;
/** Receita do DARE para a complementação de alíquota do Simples Nacional ("105 - ICMS COMPLEMENTAÇÃO DE ALÍQUOTA - SIMPLES NACIONAL"). */
export const RECEITA_COMPLEMENTACAO_TO = "105";
/** "Nome Documento": OUTROS A ESPECIFICAR (o padrão do formulário). */
const DOCUMENTO_OUTROS = "5";
const AGENTE = "Mozilla/5.0 (compatible; PortalGuaresesON/1.0)";

export type EtapaErro = "conexao" | "contribuinte" | "formulario" | "emissao" | "pdf";
export class ErroDareTo extends Error {
  constructor(
    mensagem: string,
    readonly etapa: EtapaErro = "emissao",
  ) {
    super(mensagem);
  }
}

export interface PedidoDareTo {
  /** Inscrição estadual do Tocantins (só dígitos; pode vir vazia quando a empresa tem uma só). */
  inscricaoEstadual: string;
  /** CNPJ ou CPF (só dígitos). */
  documento: string;
  /** Código IBGE do município da receita (vazio: o município de origem da empresa). */
  municipioIbge: string | null;
  receita: string;
  /** Mês de referência AAAA-MM. */
  periodo: string;
  /** Vencimento (data de pagamento) AAAA-MM-DD. */
  vencimento: string;
  valor: ValorEntrada;
  /** Observação do DARE (do que se trata e a competência). */
  observacao: string;
}

export interface PreviaDareTo {
  razaoSocial: string;
  inscricaoEstadual: string;
  municipio: string;
  total: string;
}

export interface DareEmitidoTo {
  numero: string;
  pdf: Buffer;
  linhaDigitavel: string | null;
  previa: PreviaDareTo;
}

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;
export type LerTextoPdf = (pdf: Buffer) => Promise<string>;

// -----------------------------------------------------------------------------
// Formatos
// -----------------------------------------------------------------------------
export const soDigitos = (t: string) => t.replace(/\D/g, "");

/** 1234.5 → "1.234,50" */
export function valorBr(v: ValorEntrada): string {
  const [int, frac] = dec(v).toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

/** "1.234,50" → "1234.50" */
export function valorDoSite(v: string | undefined): string | null {
  if (!v || !/\d/.test(v)) return null;
  const n = v.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : null;
}

export function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Texto aceito na observação: maiúsculas sem acento, travessão vira hífen. */
export function semAcento(t: string, max = 400): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―]/g, "-")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/** Número do DARE (nosso número) no texto da página ou do PDF. */
export function numeroDoDare(texto: string): string | null {
  const m = /(?:nosso\s*n[uú]mero|n[uú]mero\s*(?:do\s*)?(?:dare|documento)|n[ºo°.]\s*(?:do\s*)?dare)\s*[:\-]?\s*(\d[\d.\-/]{2,58}\d)/i.exec(texto);
  const n = m ? soDigitos(m[1]) : "";
  return n.length >= 4 && n.length <= 60 ? n : null;
}

/** Linha digitável de arrecadação (começa com 8: quatro blocos de 11 dígitos + dígito). */
export function linhaDigitavelDoTexto(texto: string): string | null {
  const m = /\b(8\d{10})[\s-]?(\d)\s+(\d{11})[\s-]?(\d)\s+(\d{11})[\s-]?(\d)\s+(\d{11})[\s-]?(\d)\b/.exec(texto);
  return m ? `${m[1]}-${m[2]} ${m[3]}-${m[4]} ${m[5]}-${m[6]} ${m[7]}-${m[8]}` : null;
}

// -----------------------------------------------------------------------------
// Leitura das páginas GeneXus
// -----------------------------------------------------------------------------
/** Estado da página (campo oculto GXState, em JSON). */
export function lerGxState(html: string): Record<string, unknown> | null {
  const m = /name="GXState"\s+value='([^']*)'/.exec(html) ?? /name="GXState"\s+value="([^"]*)"/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(decodificar(m[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Valores atuais dos campos do formulário, como o navegador enviaria. */
export function lerCampos(html: string): Record<string, string> {
  const campos: Record<string, string> = {};
  const form = /<form\b[^>]*id="MAINFORM"[^>]*>([\s\S]*?)<\/form>/i.exec(html)?.[1] ?? html;
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const a = atributos(m[0]);
    const tipo = (a.type ?? "text").toLowerCase();
    if (!a.name || a.name === "GXState" || ["button", "submit", "image", "reset", "file"].includes(tipo)) continue;
    if ((tipo === "checkbox" || tipo === "radio") && !("checked" in a)) continue;
    campos[a.name] = a.value ?? "";
  }
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = atributos(`<select${m[1]}>`);
    if (!a.name) continue;
    const opcoes = [...m[2].matchAll(/<option\b([^>]*)>/gi)].map((o) => atributos(`<option${o[1]}>`));
    const sel = opcoes.find((o) => "selected" in o) ?? opcoes[0];
    campos[a.name] = sel?.value ?? "";
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const a = atributos(`<textarea${m[1]}>`);
    if (a.name) campos[a.name] = decodificar(m[2]);
  }
  return campos;
}

export interface OpcaoSelect {
  valor: string;
  texto: string;
}

export function opcoesDe(html: string, nome: string): OpcaoSelect[] {
  const m = new RegExp(`<select\\b[^>]*name="${nome}"[^>]*>([\\s\\S]*?)<\\/select>`, "i").exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/<option\b([^>]*)>([^<]*)/gi)].map((o) => ({ valor: atributos(`<option${o[1]}>`).value ?? "", texto: textoVisivel(o[2]) }));
}

/** Mensagens que a SEFAZ mostrou (quadro de erros do GeneXus). */
export function mensagensDaSefaz(html: string): string[] {
  const quadro = /<span\b[^>]*id="gxErrorViewer"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1] ?? "";
  return [...quadro.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => textoVisivel(m[1])).filter(Boolean).slice(0, 5);
}

/** Linhas da seleção de inscrição estadual: [sel, ordem, IE, razão, fantasia, tipo, CNPJ, município, UF]. */
export function linhasDaSelecao(html: string): string[][] {
  const m = /name="SfileContainerDataV"\s+value='([^']*)'/.exec(html);
  if (!m) return [];
  try {
    return (JSON.parse(decodificar(m[1])) as unknown[][]).map((l) => l.map((x) => String(x ?? "")));
  } catch {
    return [];
  }
}

const COLUNAS_SELECAO = ["vITEMSEL", "vORDEM", "vCECPFCNPJ", "vCENOME", "vCENMFTS", "vTIPODOC", "vAUXESTCNPJ", "vMUNCDG", "vUFCDG"];

// -----------------------------------------------------------------------------
// Sessão (cookies), só no site da SEFAZ-TO
// -----------------------------------------------------------------------------
export interface Pagina {
  url: string;
  status: number;
  tipo: string;
  bytes: Buffer;
  html: string;
  local: string | null;
}

/** O servidor responde "Location: http://sefaz.to.gov.br:443/..." — vira https sem a porta. */
export function normalizarLocal(local: string, base: string): string {
  const u = new URL(local, base);
  if (u.port === "443") {
    u.protocol = "https:";
    u.port = "";
  }
  return u.toString();
}

function permitido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)to\.gov\.br$/i.test(u.hostname);
  } catch {
    return false;
  }
}

class Sessao {
  private cookies = new Map<string, string>();
  constructor(private buscar: Buscar) {}

  async pedir(url: string, corpo?: URLSearchParams, referer?: string): Promise<Pagina> {
    if (!permitido(url)) throw new ErroDareTo("O site da SEFAZ-TO mandou para um endereço fora do governo do Tocantins. O robô parou por segurança.", "conexao");
    const headers: Record<string, string> = { "User-Agent": AGENTE, Accept: "text/html,application/pdf,*/*", "Accept-Language": "pt-BR" };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (referer) headers.Referer = referer;
    if (corpo) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let resp: Response;
    try {
      resp = await this.buscar(url, { method: corpo ? "POST" : "GET", headers, body: corpo?.toString(), redirect: "manual", signal: AbortSignal.timeout(40_000), cache: "no-store" });
    } catch {
      throw new ErroDareTo("O site do DARE da SEFAZ-TO não respondeu. Tente de novo em alguns minutos.", "conexao");
    }
    for (const c of resp.headers.getSetCookie?.() ?? []) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    const tipo = (resp.headers.get("content-type") ?? "").toLowerCase();
    const latin1 = /charset=(iso-8859-1|windows-1252|latin1)/.test(tipo);
    const html = tipo.includes("pdf") ? "" : new TextDecoder(latin1 ? "latin1" : "utf-8").decode(bytes);
    const local = resp.headers.get("location");
    if (resp.status >= 500) throw new ErroDareTo(`O site do DARE da SEFAZ-TO está com problema (HTTP ${resp.status}). Tente mais tarde.`, "conexao");
    return { url, status: resp.status, tipo, bytes, html, local: local ? normalizarLocal(local, url) : null };
  }

  /** Pede e segue redirecionamentos (até 6). */
  async ir(url: string, corpo?: URLSearchParams, referer?: string): Promise<Pagina> {
    let p = await this.pedir(url, corpo, referer);
    for (let i = 0; i < 6 && p.status >= 300 && p.status < 400 && p.local; i++) p = await this.pedir(p.local, undefined, p.url);
    if (p.status >= 400) throw new ErroDareTo(`O site do DARE da SEFAZ-TO respondeu de um jeito inesperado (HTTP ${p.status}).`, "conexao");
    return p;
  }

  /** Envia a página com o evento (como o clique no botão do GeneXus). */
  async evento(p: Pagina, nome: string, alterar: Record<string, string>, estadoExtra: Record<string, unknown> = {}): Promise<Pagina> {
    const estado = lerGxState(p.html);
    if (!estado) throw new ErroDareTo("A página do DARE da SEFAZ-TO veio sem o estado do formulário (o site mudou?). Nada foi emitido.", "formulario");
    Object.assign(estado, { _EventName: nome, _EventGridId: "", _EventRowId: "" }, estadoExtra);
    const acao = /<form\b[^>]*id="MAINFORM"[^>]*action="([^"]+)"/i.exec(p.html)?.[1] ?? new URL(p.url).pathname.split("/").pop()!;
    const corpo = new URLSearchParams({ ...lerCampos(p.html), ...alterar, GXState: JSON.stringify(estado) });
    return this.ir(new URL(acao, p.url).toString(), corpo, p.url);
  }
}

const pagina = (p: Pagina) => new URL(p.url).pathname.split("/").pop() ?? "";

// -----------------------------------------------------------------------------
// Passos
// -----------------------------------------------------------------------------
async function abrirFormulario(s: Sessao, pedido: PedidoDareTo): Promise<Pagina> {
  // 1. Identificação do contribuinte (CNPJ)
  const ident = await s.ir(URL_DARE_AVULSO);
  if (!/vCECPFCNPJ/.test(ident.html)) throw new ErroDareTo("A tela de identificação do DARE da SEFAZ-TO mudou. Emita pelo site.", "formulario");
  const doc = soDigitos(pedido.documento);
  let p = await s.evento(ident, "EENTER.", { vINSCRICAOESTADUAL: "", vCECPFCNPJ: doc }, { GX_FocusControl: "vCECPFCNPJ" });
  if (pagina(p) !== "hnetcccnco") {
    const msg = mensagensDaSefaz(p.html)[0];
    throw new ErroDareTo(`A SEFAZ-TO não encontrou o contribuinte do CNPJ ${doc}${msg ? `: ${msg}` : "."}`, "contribuinte");
  }

  // 2. Seleção da inscrição estadual
  const linhas = linhasDaSelecao(p.html);
  const ie = soDigitos(pedido.inscricaoEstadual);
  let idx = ie ? linhas.findIndex((l) => soDigitos(l[2]) === ie) : linhas.length === 1 ? 0 : -1;
  if (idx < 0 && !ie && linhas.length > 1) throw new ErroDareTo(`O CNPJ ${doc} tem ${linhas.length} inscrições estaduais na SEFAZ-TO: cadastre a inscrição da empresa no portal.`, "contribuinte");
  if (idx < 0) throw new ErroDareTo(`A inscrição estadual ${ie} não aparece para o CNPJ ${doc} na SEFAZ-TO. Confira o cadastro da empresa.`, "contribuinte");
  if (idx >= 9999) idx = 0;
  const linha = String(idx + 1).padStart(4, "0");
  const grade: Record<string, string> = { nRC_Sfile: String(linhas.length), SfileContainerDataV: JSON.stringify(linhas) };
  linhas.forEach((l, i) => COLUNAS_SELECAO.forEach((c, j) => (grade[`${c}_${String(i + 1).padStart(4, "0")}`] = (l[j] ?? "").trim())));
  p = await s.evento(p, "EENTER.", grade, { _EventGridId: "17", _EventRowId: linha, SFILE_ROW: linha });
  if (pagina(p) !== "hdrewp02") {
    const msg = mensagensDaSefaz(p.html)[0];
    throw new ErroDareTo(`A SEFAZ-TO não abriu o formulário do DARE${msg ? `: ${msg}` : "."}`, "contribuinte");
  }
  return p;
}

/** Preenche o formulário e pede "Atualizar Valores"; devolve a página com o total calculado pela SEFAZ. */
async function preencherECalcular(s: Sessao, form: Pagina, pedido: PedidoDareTo): Promise<{ pagina: Pagina; previa: PreviaDareTo }> {
  const campos = lerCampos(form.html);
  const ie = soDigitos(pedido.inscricaoEstadual);
  if (ie && soDigitos(campos.vDREINSEST ?? "") !== ie) throw new ErroDareTo("A SEFAZ-TO abriu o formulário com outra inscrição estadual. Nada foi emitido.", "formulario");
  for (const c of ["vDRECDGMUN", "vDRECDGRCT", "vDREDTAVEN", "vDREREFCHAR", "vDREVLRPRI", "vDREINFCOM"]) {
    if (!(c in campos)) throw new ErroDareTo("O formulário do DARE da SEFAZ-TO mudou (campo que o robô conhece sumiu). Nada foi emitido: emita pelo site.", "formulario");
  }
  if (!opcoesDe(form.html, "vDRECDGRCT").some((o) => o.valor === pedido.receita)) {
    throw new ErroDareTo(`A receita ${pedido.receita} não aparece no formulário do DARE da SEFAZ-TO. Emita pelo site.`, "formulario");
  }
  const municipio = pedido.municipioIbge && opcoesDe(form.html, "vDRECDGMUN").some((o) => o.valor === pedido.municipioIbge) ? pedido.municipioIbge : campos.vMUNCDGORI;
  if (!municipio || municipio === "0") throw new ErroDareTo("Não foi possível escolher o município da receita no DARE. Emita pelo site.", "formulario");

  // Escolha da receita (o formulário recarrega o subcódigo e as regras da receita)
  let p = await s.evento(form, "EVDRECDGRCT.CLICK.", { vDRECDGMUN: municipio, vDRECDGRCT: pedido.receita });
  const subcodigos = opcoesDe(p.html, "vSUBCDGRCT").filter((o) => o.valor && o.valor !== "0");
  if (subcodigos.length) {
    throw new ErroDareTo(`A receita ${pedido.receita} passou a pedir subcódigo no DARE da SEFAZ-TO (${subcodigos.map((o) => o.texto).slice(0, 3).join(", ")}). Nada foi emitido: emita pelo site.`, "formulario");
  }
  const preenchimento = {
    vDRECDGMUN: municipio,
    vDRETDCORI: lerCampos(p.html).vDRETDCORI || DOCUMENTO_OUTROS,
    vDRECDGRCT: pedido.receita,
    vSUBCDGRCT: "0",
    vDREDTAVEN: dataBr(pedido.vencimento),
    vDREREFCHAR: `${pedido.periodo.slice(5, 7)}/${pedido.periodo.slice(0, 4)}`,
    vDREVLRPRI: valorBr(pedido.valor),
    vDREVLRMLT: "0,00",
    vDREVLRJUR: "0,00",
    vDREVLRATM: "0,00",
    vDREVLRTSE: "0,00",
    vDREINFCOM: semAcento(pedido.observacao),
  };
  // "Atualizar Valores": a SEFAZ calcula o total
  p = await s.evento(p, "E'CALCULAR'.", preenchimento);
  const msgs = mensagensDaSefaz(p.html);
  const depois = lerCampos(p.html);
  if (pagina(p) !== "hdrewp02" || !("vDREVLRTOT" in depois)) {
    throw new ErroDareTo(`A SEFAZ-TO não calculou o DARE${msgs.length ? `: ${msgs.join(" ")}` : "."}`, "formulario");
  }
  const total = valorDoSite(depois.vDREVLRTOT);
  const esperado = dec(pedido.valor).toFixed(2);
  if (total !== esperado) {
    throw new ErroDareTo(
      `A SEFAZ-TO calculou o DARE em R$ ${total ? valorBr(total) : "?"}, diferente do valor da apuração (R$ ${valorBr(esperado)})${msgs.length ? `: ${msgs.join(" ")}` : ""}. Nada foi emitido.`,
      "formulario",
    );
  }
  const opMun = opcoesDe(p.html, "vDRECDGMUN").find((o) => o.valor === municipio);
  return {
    pagina: p,
    previa: { razaoSocial: depois.vDRERAZSOC ?? "", inscricaoEstadual: depois.vDREINSEST ?? "", municipio: opMun ? opMun.texto.replace(/\s+-\s+\d+$/, "").trim() : municipio, total },
  };
}

/** Endereço do relatório (PDF) na resposta do Confirmar: redirecionamento, comando de janela ou link. */
export function enderecoDoRelatorio(html: string, base: string): string | null {
  const conhecidas = /hnetccwkda|hnetcccnco|hdrewp02/i;
  const candidatos = [
    ...[...html.matchAll(/"(?:redirect|popup)"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/g)].map((m) => m[1].replace(/\\\//g, "/")),
    ...[...html.matchAll(/window\.open\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...html.matchAll(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    // Outro programa do próprio sistema citado na resposta (o relatório do DARE, "a...?parâmetros")
    ...[...html.matchAll(/\/dare\/servlet\/(a[a-z0-9]{5,12}(?:\?[^"'<>\s]*)?)/gi), ...html.matchAll(/["'](a[a-z0-9]{5,12}\?[^"'<>\s]+)["']/gi)]
      .map((m) => m[1])
      .filter((u) => !conhecidas.test(u)),
    ...[...html.matchAll(/<(?:a|iframe|embed|object)\b[^>]*(?:href|src|data)="([^"]+)"/gi)].map((m) => decodificar(m[1])).filter((u) => /\.pdf|servlet\/a|rel|dare/i.test(u) && !/static|barra\.to\.gov\.br|adobe/i.test(u)),
  ];
  for (const c of candidatos) {
    try {
      const u = normalizarLocal(c, base);
      if (permitido(u)) return u;
    } catch {
      /* ignora */
    }
  }
  return null;
}

const ehPdf = (p: Pagina) => p.bytes.subarray(0, 5).toString("latin1") === "%PDF-";

async function textoDoPdfPadrao(pdf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

// -----------------------------------------------------------------------------
// Operações
// -----------------------------------------------------------------------------
/** Vai até "Atualizar Valores" e confere o total, sem confirmar (nada é emitido). */
export async function conferirDareTo(pedido: PedidoDareTo, buscar: Buscar = fetch): Promise<PreviaDareTo> {
  const s = new Sessao(buscar);
  const form = await abrirFormulario(s, pedido);
  return (await preencherECalcular(s, form, pedido)).previa;
}

/**
 * Emite o DARE e devolve o número e o PDF oficial, conferido (valor,
 * vencimento e inscrição/CNPJ no PDF). Qualquer diferença: para sem anexar.
 */
export async function emitirDareTo(pedido: PedidoDareTo, opcoes: { buscar?: Buscar; lerTextoPdf?: LerTextoPdf } = {}): Promise<DareEmitidoTo> {
  const s = new Sessao(opcoes.buscar ?? fetch);
  const lerTexto = opcoes.lerTextoPdf ?? textoDoPdfPadrao;
  const form = await abrirFormulario(s, pedido);
  const { pagina: calculado, previa } = await preencherECalcular(s, form, pedido);

  // Confirmar
  let resp = await s.evento(calculado, "E'CONFIRM'.", {});
  if (!ehPdf(resp)) {
    const msgs = mensagensDaSefaz(resp.html);
    const relatorio = enderecoDoRelatorio(resp.html, resp.url);
    if (relatorio) resp = await s.ir(relatorio, undefined, resp.url);
    else if (msgs.length) throw new ErroDareTo(`A SEFAZ-TO não emitiu o DARE: ${msgs.join(" ")}`, "emissao");
  }
  if (!ehPdf(resp)) {
    // Diagnóstico para ajustar o robô (sem dados pessoais: só o caminho, o tipo e os endereços citados)
    console.error("[dare-to] Confirmar sem PDF", {
      pagina: pagina(resp),
      status: resp.status,
      tipo: resp.tipo,
      mensagens: mensagensDaSefaz(resp.html),
      enderecos: [...new Set([...resp.html.matchAll(/(?:servlet\/|url"\s*:\s*")([a-z0-9]{6,14})/gi)].map((m) => m[1]))].slice(0, 10),
    });
    const numero = numeroDoDare(textoVisivel(resp.html));
    throw new ErroDareTo(`${numero ? `O DARE nº ${numero} foi registrado na SEFAZ-TO, mas o` : "O"} PDF do DARE não veio. Emita a 2ª via pelo site e anexe na empresa.`, "pdf");
  }

  let texto: string;
  try {
    texto = await lerTexto(resp.bytes);
  } catch {
    throw new ErroDareTo("O DARE foi gerado, mas o PDF não pôde ser conferido. Confira no site da SEFAZ-TO antes de usar.", "pdf");
  }
  const digitos = soDigitos(texto);
  const ie = soDigitos(pedido.inscricaoEstadual);
  const contribuinteOk = (ie && digitos.includes(ie)) || digitos.includes(soDigitos(pedido.documento));
  const problemas = [
    texto.includes(valorBr(pedido.valor)) ? "" : `valor R$ ${valorBr(pedido.valor)}`,
    texto.includes(dataBr(pedido.vencimento)) ? "" : `vencimento ${dataBr(pedido.vencimento)}`,
    contribuinteOk ? "" : "inscrição/CNPJ da empresa",
  ].filter(Boolean);
  const linhaDigitavel = linhaDigitavelDoTexto(texto);
  const numero = numeroDoDare(texto) ?? (linhaDigitavel ? soDigitos(linhaDigitavel) : null);
  if (problemas.length) {
    throw new ErroDareTo(`O DARE${numero ? ` nº ${numero}` : ""} foi gerado, mas o PDF não confere (${problemas.join(", ")}). Ele não foi anexado: confira no site da SEFAZ-TO.`, "pdf");
  }
  if (!numero) throw new ErroDareTo("O DARE foi gerado, mas o número não foi encontrado no PDF. Confira no site da SEFAZ-TO e anexe na empresa.", "pdf");
  return { numero: numero.slice(0, 60), pdf: resp.bytes, linhaDigitavel, previa };
}
