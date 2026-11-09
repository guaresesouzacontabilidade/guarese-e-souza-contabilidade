import { dec, type ValorEntrada } from "@/lib/dinheiro";
import {
  lerFormularios,
  lerLinks,
  mensagensDaPagina,
  normalizar,
  temCaptcha,
  textoVisivel,
  tituloDaPagina,
  type CampoFormulario,
  type FormularioHtml,
} from "./html";

/**
 * Robô do DARE da SEFAZ-TO (dare.sefaz.to.gov.br).
 *
 * O sistema exige entrar com o login do governo do Tocantins (TOauth: CPF ou
 * e-mail e senha), cadastrado pelo escritório. O robô faz o caminho de uma
 * pessoa no navegador:
 *
 *  1. abre o DARE, que manda para a tela de entrada do TOauth; entra com o
 *     acesso do escritório e volta ao DARE (aceita a autorização, se pedida);
 *  2. procura o formulário de emissão e reconhece os campos pelos rótulos
 *     (inscrição/CNPJ, receita, referência, vencimento, valor, informações);
 *  3. preenche com a receita da complementação (105), o mês, o vencimento do
 *     dia 9 e o valor da apuração do portal, e envia;
 *  4. baixa o PDF oficial e confere valor, vencimento e contribuinte.
 *
 * Segurança: o login só é enviado a endereços *.to.gov.br em HTTPS; nada é
 * guardado além do resultado. Se uma tela vier diferente do esperado (campo
 * que o robô não conhece, captcha, site fora do ar), ele para com a mensagem e
 * nada é anexado. "Testar conexão" faz os passos 1 e 2 sem emitir e guarda só
 * a estrutura das telas (nomes dos campos), para ajustar o robô se a SEFAZ mudar.
 */
export const BASE_DARE_TO = "https://dare.sefaz.to.gov.br";
const HOST_DARE = new URL(BASE_DARE_TO).host;
/** Receita do DARE para a complementação de alíquota do Simples Nacional (comunicado da SEFAZ-TO, Portaria nº 353/2012). */
export const RECEITA_COMPLEMENTACAO_TO = "105";
const AGENTE = "Mozilla/5.0 (compatible; PortalGuaresesON/1.0)";

export type EtapaErro = "conexao" | "login" | "formulario" | "emissao" | "pdf";
export class ErroDareTo extends Error {
  constructor(
    mensagem: string,
    readonly etapa: EtapaErro = "emissao",
  ) {
    super(mensagem);
  }
}

export interface CredenciaisDareTo {
  login: string;
  senha: string;
}

export interface PedidoDareTo {
  /** Inscrição estadual (só dígitos). */
  inscricaoEstadual: string;
  /** CNPJ ou CPF da empresa (só dígitos). */
  documento: string;
  receita: string;
  /** Mês de referência AAAA-MM. */
  periodo: string;
  /** Vencimento AAAA-MM-DD. */
  vencimento: string;
  valor: ValorEntrada;
  /** Informações complementares (sem acento; cortado no tamanho do campo). */
  informacao: string;
}

export interface DareEmitidoTo {
  numero: string;
  pdf: Buffer;
  linhaDigitavel: string | null;
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

export function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function semAcento(t: string, max = 200): string {
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

/** "123.456.789-01" → "***.456.789-**"; e-mail → "jo***@dominio" */
export function mascararLogin(login: string): string {
  const t = login.trim();
  if (t.includes("@")) {
    const [u, d] = t.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }
  const d = soDigitos(t);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : `${t.slice(0, 2)}***`;
}

/** CPF vai só com os números; e-mail como foi digitado. */
export function loginParaEnvio(login: string): string {
  const t = login.trim();
  return !t.includes("@") && soDigitos(t).length === 11 ? soDigitos(t) : t;
}

/** Número do DARE (nosso número) no texto da página ou do PDF. */
export function numeroDoDare(texto: string): string | null {
  const m =
    /(?:nosso\s*n[uú]mero|n[uú]mero\s*(?:do\s*)?(?:dare|documento)|n[ºo°.]\s*(?:do\s*)?dare|dare\s*n[ºo°.])\s*[:\-]?\s*(\d[\d.\-/ ]{2,58}\d)/i.exec(texto);
  const n = m ? soDigitos(m[1]) : "";
  return n.length >= 4 && n.length <= 60 ? n : null;
}

/** Linha digitável de arrecadação (começa com 8: quatro blocos de 11 dígitos + dígito). */
export function linhaDigitavelDoTexto(texto: string): string | null {
  const m = /\b(8\d{10})[\s-]?(\d)\s+(\d{11})[\s-]?(\d)\s+(\d{11})[\s-]?(\d)\s+(\d{11})[\s-]?(\d)\b/.exec(texto);
  return m ? `${m[1]}-${m[2]} ${m[3]}-${m[4]} ${m[5]}-${m[6]} ${m[7]}-${m[8]}` : null;
}

// -----------------------------------------------------------------------------
// Sessão com cookies, só no governo do Tocantins
// -----------------------------------------------------------------------------
export interface Pagina {
  url: string;
  status: number;
  tipo: string;
  bytes: Buffer;
  html: string;
}

function hostPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)to\.gov\.br$/i.test(u.hostname);
  } catch {
    return false;
  }
}

class Sessao {
  /** domínio → nome → valor */
  private cookies = new Map<string, Map<string, string>>();
  constructor(private buscar: Buscar) {}

  private cabecalhoCookies(host: string): string {
    const pares: string[] = [];
    for (const [dominio, lista] of this.cookies) {
      if (host === dominio || host.endsWith(`.${dominio}`)) for (const [k, v] of lista) pares.push(`${k}=${v}`);
    }
    return pares.join("; ");
  }

  private guardarCookies(host: string, resp: Response) {
    for (const c of resp.headers.getSetCookie?.() ?? []) {
      const [par, ...atributos] = c.split(";");
      const i = par.indexOf("=");
      if (i <= 0) continue;
      const dominioAttr = atributos.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
      let dominio = dominioAttr ? dominioAttr.slice(7).replace(/^\./, "").toLowerCase() : host;
      if (!(host === dominio || host.endsWith(`.${dominio}`))) dominio = host;
      if (!this.cookies.has(dominio)) this.cookies.set(dominio, new Map());
      this.cookies.get(dominio)!.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  async pedir(url: string, opcoes: { metodo?: "GET" | "POST"; corpo?: URLSearchParams; referer?: string } = {}): Promise<Pagina & { local: string | null }> {
    if (!hostPermitido(url)) throw new ErroDareTo("O sistema da SEFAZ-TO mandou para um endereço fora do governo do Tocantins. O robô parou por segurança.", "conexao");
    const u = new URL(url);
    let alvo = url;
    let corpo: URLSearchParams | undefined = opcoes.corpo;
    if ((opcoes.metodo ?? "GET") === "GET" && corpo) {
      u.search = corpo.toString();
      alvo = u.toString();
      corpo = undefined;
    }
    const headers: Record<string, string> = { "User-Agent": AGENTE, Accept: "text/html,application/xhtml+xml,application/pdf,*/*", "Accept-Language": "pt-BR" };
    const ck = this.cabecalhoCookies(u.hostname);
    if (ck) headers.Cookie = ck;
    if (opcoes.referer) headers.Referer = opcoes.referer;
    if (corpo) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let resp: Response;
    try {
      resp = await this.buscar(alvo, { method: opcoes.metodo ?? "GET", headers, body: corpo?.toString(), redirect: "manual", signal: AbortSignal.timeout(30_000), cache: "no-store" });
    } catch {
      throw new ErroDareTo("O site da SEFAZ-TO não respondeu. Tente de novo em alguns minutos.", "conexao");
    }
    this.guardarCookies(u.hostname, resp);
    const bytes = Buffer.from(await resp.arrayBuffer());
    const tipo = (resp.headers.get("content-type") ?? "").toLowerCase();
    const latin1 = /charset=(iso-8859-1|windows-1252|latin1)/.test(tipo);
    const html = tipo.includes("pdf") ? "" : new TextDecoder(latin1 ? "latin1" : "utf-8").decode(bytes);
    const local = resp.headers.get("location");
    return { url: alvo, status: resp.status, tipo, bytes, html, local: local ? new URL(local, alvo).toString() : null };
  }

  /** Pede e segue os redirecionamentos (até 10), como o navegador. */
  async ir(url: string, opcoes: { metodo?: "GET" | "POST"; corpo?: URLSearchParams; referer?: string } = {}): Promise<Pagina> {
    let p = await this.pedir(url, opcoes);
    for (let i = 0; i < 10 && p.status >= 300 && p.status < 400 && p.local; i++) {
      const manter = p.status === 307 || p.status === 308;
      p = await this.pedir(p.local, manter ? { ...opcoes, referer: p.url } : { referer: p.url });
    }
    if (p.status >= 500) throw new ErroDareTo(`O site da SEFAZ-TO está com problema (HTTP ${p.status}). Tente mais tarde.`, "conexao");
    if (p.status >= 400 && p.status !== 422) throw new ErroDareTo(`O site da SEFAZ-TO respondeu de um jeito inesperado (HTTP ${p.status}).`, "conexao");
    return p;
  }
}

/** Campos a enviar, como o navegador: ocultos e preenchidos; o botão escolhido. */
export function montarEnvio(form: FormularioHtml, valores: Record<string, string>, botao?: RegExp): URLSearchParams {
  const corpo = new URLSearchParams();
  for (const c of form.campos) {
    if (c.desabilitado || c.tipo === "submit" || c.tipo === "password" && !(c.nome in valores)) continue;
    const v = c.nome in valores ? valores[c.nome] : c.valor;
    if ((c.tipo === "checkbox" || c.tipo === "radio") && !v) continue;
    corpo.append(c.nome, v);
  }
  const botoes = form.campos.filter((c) => c.tipo === "submit" && !c.desabilitado);
  const escolhido = (botao && botoes.find((b) => botao.test(normalizar(`${b.texto ?? ""} ${b.valor}`)))) || botoes[0];
  if (escolhido?.nome) corpo.append(escolhido.nome, escolhido.valor);
  return corpo;
}

// -----------------------------------------------------------------------------
// Entrada pelo TOauth
// -----------------------------------------------------------------------------
const formularioDeSenha = (p: Pagina) => lerFormularios(p.html, p.url).find((f) => f.campos.some((c) => c.tipo === "password")) ?? null;
const noDare = (p: Pagina) => new URL(p.url).host === HOST_DARE;

async function entrar(s: Sessao, cred: CredenciaisDareTo): Promise<Pagina> {
  let p = await s.ir(`${BASE_DARE_TO}/users/sign_in`);
  if (noDare(p) && !formularioDeSenha(p)) return p;
  if (temCaptcha(p.html)) throw new ErroDareTo("A tela de entrada do governo do Tocantins pediu a verificação “não sou um robô”. Emita pelo site da SEFAZ-TO.", "login");
  const form = formularioDeSenha(p);
  if (!form) throw new ErroDareTo("A tela de entrada do governo do Tocantins não abriu como esperado.", "login");
  const senha = form.campos.find((c) => c.tipo === "password")!;
  const usuario =
    form.campos.find((c) => !c.desabilitado && ["text", "email", "tel"].includes(c.tipo) && /login|email|cpf|usuario|user/i.test(c.nome)) ??
    form.campos.find((c) => !c.desabilitado && ["text", "email", "tel"].includes(c.tipo));
  if (!usuario) throw new ErroDareTo("A tela de entrada do governo do Tocantins não tem o campo de CPF ou e-mail esperado.", "login");
  p = await s.ir(form.acao, { metodo: form.metodo, corpo: montarEnvio(form, { [usuario.nome]: loginParaEnvio(cred.login), [senha.nome]: cred.senha }, /entrar|acessar|login/), referer: p.url });

  // Autorização do aplicativo DARE (pedida no primeiro acesso)
  for (let i = 0; i < 2 && !noDare(p); i++) {
    if (formularioDeSenha(p)) {
      const msg = mensagensDaPagina(p.html)[0];
      throw new ErroDareTo(`O governo do Tocantins não aceitou o login${msg ? `: ${msg}` : " (confira o CPF/e-mail e a senha)."}`, "login");
    }
    const autorizar = lerFormularios(p.html, p.url).find((f) => f.campos.some((c) => c.tipo === "submit" && /autoriz|authoriz|permitir|aceitar|continuar|allow/.test(normalizar(`${c.texto ?? ""} ${c.valor}`))));
    if (!autorizar) break;
    p = await s.ir(autorizar.acao, { metodo: autorizar.metodo, corpo: montarEnvio(autorizar, {}, /autoriz|authoriz|permitir|aceitar|continuar|allow/), referer: p.url });
  }
  if (!noDare(p) || formularioDeSenha(p)) {
    const msg = mensagensDaPagina(p.html)[0];
    throw new ErroDareTo(`Não foi possível entrar no sistema de DARE da SEFAZ-TO com este acesso${msg ? `: ${msg}` : "."}`, "login");
  }
  return p;
}

// -----------------------------------------------------------------------------
// Reconhecimento do formulário de emissão
// -----------------------------------------------------------------------------
export type Papel = "inscricao" | "documento" | "receita" | "referencia" | "mes" | "ano" | "vencimento" | "valor" | "informacao";

function nomeLegivel(nome: string): string {
  const ultimo = /\[([^\]]+)\]$/.exec(nome)?.[1] ?? nome;
  return ultimo.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Papel do campo pelo rótulo (ou, sem rótulo útil, pelo nome). */
export function papelDoCampo(c: CampoFormulario): Papel | null {
  if (c.tipo === "hidden" || c.tipo === "submit" || c.tipo === "password" || c.tipo === "checkbox") return null;
  for (const fonte of [normalizar(c.rotulo), normalizar(nomeLegivel(c.nome))]) {
    const t = fonte.replace(/\*/g, "").trim();
    if (!t) continue;
    if (/\bvalor\b/.test(t) && !/juros|multa|total|desconto|correc|acresc|atualiz|unitario|taxa/.test(t)) return "valor";
    if (/vencimento|data (de|do|para) pagamento|pagar ate|data limite|validade/.test(t)) return "vencimento";
    if (/sub ?(codigo|receita)/.test(t)) return null;
    if (/\bmes\b/.test(t) && /\bano\b/.test(t)) return "referencia";
    if (/referencia|competencia|periodo/.test(t) && !/\bmes\b|\bano\b/.test(t)) return "referencia";
    if (/^mes\b|\bmes\b/.test(t)) return "mes";
    if (/^ano\b|\bano\b/.test(t)) return "ano";
    if (/receita|tributo|codigo de arrecadacao|natureza/.test(t)) return "receita";
    if (/inscricao estadual|\bie\b|insc\.? ?est/.test(t)) return "inscricao";
    if (/\bcnpj\b|\bcpf\b|contribuinte|documento/.test(t)) return "documento";
    if (/informac|observac|historico|complement|descricao/.test(t)) return "informacao";
  }
  return null;
}

export interface AnaliseFormulario {
  formulario: FormularioHtml;
  papeis: Partial<Record<Papel, string>>;
  /** Papéis indispensáveis que o robô não achou. */
  faltando: string[];
  /** Campos obrigatórios que o robô não sabe preencher. */
  desconhecidos: string[];
  pontos: number;
}

export function analisarFormulario(form: FormularioHtml): AnaliseFormulario {
  const papeis: Partial<Record<Papel, string>> = {};
  for (const c of form.campos) {
    const p = papelDoCampo(c);
    if (p && !c.desabilitado && !papeis[p]) papeis[p] = c.nome;
  }
  const faltando: string[] = [];
  if (!papeis.valor) faltando.push("valor");
  if (!papeis.receita) faltando.push("receita");
  if (!papeis.vencimento) faltando.push("vencimento");
  if (!papeis.referencia && !(papeis.mes && papeis.ano)) faltando.push("mês de referência");
  if (!papeis.inscricao && !papeis.documento) faltando.push("inscrição estadual ou CNPJ");
  const usados = new Set(Object.values(papeis));
  const desconhecidos = form.campos
    .filter((c) => !["hidden", "submit", "password", "checkbox"].includes(c.tipo) && !c.desabilitado && c.obrigatorio && !usados.has(c.nome))
    .filter((c) => (c.tipo === "select" ? !c.opcoes.some((o) => o.selecionada && o.valor) : !c.valor))
    .map((c) => c.rotulo || c.nome);
  return { formulario: form, papeis, faltando, desconhecidos, pontos: Object.keys(papeis).length };
}

function melhorFormulario(p: Pagina): AnaliseFormulario | null {
  const analises = lerFormularios(p.html, p.url)
    .filter((f) => !f.campos.some((c) => c.tipo === "password"))
    .map(analisarFormulario)
    .filter((a) => a.papeis.valor || a.papeis.receita);
  return analises.sort((a, b) => b.pontos - a.pontos)[0] ?? null;
}

const caminho = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

/** Estrutura da página para o mapeamento (sem valores, tokens nem consultas na URL). */
export function resumoPagina(p: Pagina) {
  return {
    caminho: caminho(p.url),
    titulo: tituloDaPagina(p.html),
    links: lerLinks(p.html, p.url)
      .filter((l) => hostPermitido(l.href))
      .slice(0, 40)
      .map((l) => ({ texto: l.texto.slice(0, 60), caminho: caminho(l.href) })),
    formularios: lerFormularios(p.html, p.url)
      .filter((f) => !f.campos.some((c) => c.tipo === "password"))
      .slice(0, 5)
      .map((f) => ({
        acao: caminho(f.acao),
        metodo: f.metodo,
        campos: f.campos.slice(0, 60).map((c) => ({
          nome: c.nome,
          tipo: c.tipo,
          rotulo: (c.tipo === "submit" ? (c.texto ?? c.valor) : c.rotulo).slice(0, 80),
          obrigatorio: c.obrigatorio,
          opcoes: c.opcoes.slice(0, 40).map((o) => ({ valor: o.valor.slice(0, 40), texto: o.texto.slice(0, 80) })),
        })),
      })),
  };
}
export type ResumoPagina = ReturnType<typeof resumoPagina>;

const LINK_EMISSAO = /(nov[oa]|emitir|emissao|gerar|cadastrar|solicitar|incluir)/;
const LINK_PROIBIDO = /sair|sign.?out|logout|cancel|exclu|delet|remov|senha|perfil|conta/;

async function abrirFormulario(s: Sessao, inicio: Pagina): Promise<{ pagina: Pagina; analise: AnaliseFormulario | null; visitadas: ResumoPagina[] }> {
  const visitadas = [resumoPagina(inicio)];
  let melhor: { pagina: Pagina; analise: AnaliseFormulario } | null = null;
  const a0 = melhorFormulario(inicio);
  if (a0) melhor = { pagina: inicio, analise: a0 };
  const pronto = () => melhor && !melhor.analise.faltando.length && !melhor.analise.desconhecidos.length;
  if (!pronto()) {
    const links = lerLinks(inicio.html, inicio.url)
      .filter((l) => new URL(l.href).host === HOST_DARE && !/\.pdf/i.test(l.href))
      .filter((l) => {
        const t = normalizar(`${l.texto} ${caminho(l.href).replace(/[/_-]+/g, " ")}`);
        return LINK_EMISSAO.test(t) && !LINK_PROIBIDO.test(t);
      })
      .filter((l, i, todos) => todos.findIndex((x) => x.href === l.href) === i)
      .slice(0, 6);
    for (const l of links) {
      const p = await s.ir(l.href, { referer: inicio.url });
      visitadas.push(resumoPagina(p));
      const a = melhorFormulario(p);
      if (a && (!melhor || a.pontos > melhor.analise.pontos)) melhor = { pagina: p, analise: a };
      if (pronto()) break;
    }
  }
  return { pagina: melhor?.pagina ?? inicio, analise: melhor?.analise ?? null, visitadas };
}

// -----------------------------------------------------------------------------
// Preenchimento
// -----------------------------------------------------------------------------
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function opcao(c: CampoFormulario, teste: (valor: string, texto: string) => boolean): string | null {
  const o = c.opcoes.find((x) => x.valor && teste(x.valor, normalizar(x.texto)));
  return o ? o.valor : null;
}

export function valorDoCampo(c: CampoFormulario, papel: Papel, pedido: PedidoDareTo): string {
  const [ano, mes] = pedido.periodo.split("-");
  const ie = soDigitos(pedido.inscricaoEstadual);
  const doc = soDigitos(pedido.documento);
  const exigirOpcao = (v: string | null, oque: string) => {
    if (v == null) throw new ErroDareTo(`O formulário do DARE não oferece ${oque}. Nada foi emitido.`, "formulario");
    return v;
  };
  switch (papel) {
    case "inscricao":
      return c.tipo === "select" ? exigirOpcao(opcao(c, (v, t) => soDigitos(v) === ie || soDigitos(t).includes(ie)), `a inscrição estadual ${ie} para este acesso`) : ie;
    case "documento": {
      const alvo = doc || ie;
      return c.tipo === "select" ? exigirOpcao(opcao(c, (v, t) => soDigitos(v) === alvo || soDigitos(t).includes(alvo)), `a empresa (CNPJ ${doc}) para este acesso`) : alvo;
    }
    case "receita":
      return c.tipo === "select"
        ? exigirOpcao(opcao(c, (v, t) => v === pedido.receita || t.startsWith(pedido.receita) || new RegExp(`(^|\\D)${pedido.receita}(\\D|$)`).test(t)), `a receita ${pedido.receita}`)
        : pedido.receita;
    case "referencia":
      if (c.tipo === "month") return `${ano}-${mes}`;
      if (c.tipo === "select") return exigirOpcao(opcao(c, (v, t) => [`${mes}/${ano}`, `${ano}-${mes}`, `${mes}${ano}`, `${ano}${mes}`].some((x) => v === x || t.includes(x))), `o mês ${mes}/${ano}`);
      return `${mes}/${ano}`;
    case "mes":
      if (c.tipo === "select") return exigirOpcao(opcao(c, (v, t) => Number(v) === Number(mes) || t.startsWith(MESES[Number(mes) - 1]) || Number(t) === Number(mes)), `o mês ${mes}`);
      return mes;
    case "ano":
      if (c.tipo === "select") return exigirOpcao(opcao(c, (v) => v === ano), `o ano ${ano}`);
      return ano;
    case "vencimento":
      return c.tipo === "date" ? pedido.vencimento : dataBr(pedido.vencimento);
    case "valor":
      return c.tipo === "number" ? dec(pedido.valor).toFixed(2) : valorBr(pedido.valor);
    case "informacao":
      return semAcento(pedido.informacao, c.maxLength ?? 200);
  }
}

export function preencher(analise: AnaliseFormulario, pedido: PedidoDareTo): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const [papel, nome] of Object.entries(analise.papeis) as [Papel, string][]) {
    const c = analise.formulario.campos.find((x) => x.nome === nome)!;
    // Inscrição e CNPJ: preenche os dois quando os dois existem
    valores[nome] = valorDoCampo(c, papel, pedido);
  }
  return valores;
}

// -----------------------------------------------------------------------------
// PDF
// -----------------------------------------------------------------------------
async function textoDoPdfPadrao(pdf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

const ehPdf = (p: Pagina) => p.tipo.includes("application/pdf") && p.bytes.subarray(0, 5).toString("latin1") === "%PDF-";

async function buscarPdf(s: Sessao, p: Pagina): Promise<Pagina | null> {
  if (ehPdf(p)) return p;
  const link = lerLinks(p.html, p.url).find((l) => hostPermitido(l.href) && (/\.pdf(\?|$)/i.test(l.href) || /imprimir|\bpdf\b|baixar|download|visualizar|2a via|segunda via/.test(normalizar(l.texto))));
  if (link) {
    const pdf = await s.ir(link.href, { referer: p.url });
    if (ehPdf(pdf)) return pdf;
  }
  const form = lerFormularios(p.html, p.url).find((f) => f.campos.some((c) => c.tipo === "submit" && /imprimir|\bpdf\b|baixar|gerar dare|emitir dare/.test(normalizar(`${c.texto ?? ""} ${c.valor}`))));
  if (form) {
    const pdf = await s.ir(form.acao, { metodo: form.metodo, corpo: montarEnvio(form, {}, /imprimir|\bpdf\b|baixar|gerar dare|emitir dare/), referer: p.url });
    if (ehPdf(pdf)) return pdf;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Operações
// -----------------------------------------------------------------------------
export interface ResultadoTesteDareTo {
  ok: boolean;
  mensagem: string;
  mapeamento: { visitadas: ResumoPagina[]; escolhido: { caminho: string; papeis: Partial<Record<Papel, string>>; faltando: string[]; desconhecidos: string[] } | null };
}

/** Entra e procura o formulário, sem emitir nada. */
export async function testarDareTo(cred: CredenciaisDareTo, buscar: Buscar = fetch): Promise<ResultadoTesteDareTo> {
  const s = new Sessao(buscar);
  const inicio = await entrar(s, cred);
  const { pagina, analise, visitadas } = await abrirFormulario(s, inicio);
  const escolhido = analise ? { caminho: caminho(pagina.url), papeis: analise.papeis, faltando: analise.faltando, desconhecidos: analise.desconhecidos } : null;
  if (!analise) return { ok: false, mensagem: "Entrou no sistema de DARE, mas não achou o formulário de emissão. A estrutura das telas foi guardada para ajustar o robô.", mapeamento: { visitadas, escolhido } };
  if (analise.faltando.length || analise.desconhecidos.length) {
    const partes = [
      analise.faltando.length ? `não achou ${analise.faltando.join(", ")}` : "",
      analise.desconhecidos.length ? `campos obrigatórios que o robô ainda não conhece: ${analise.desconhecidos.slice(0, 5).join(", ")}` : "",
    ].filter(Boolean);
    return { ok: false, mensagem: `Entrou e achou o formulário do DARE, mas ${partes.join("; ")}. A estrutura foi guardada para ajustar o robô.`, mapeamento: { visitadas, escolhido } };
  }
  return { ok: true, mensagem: "Entrou no sistema de DARE da SEFAZ-TO e reconheceu todos os campos do formulário. Pronto para emitir.", mapeamento: { visitadas, escolhido } };
}

/**
 * Emite o DARE e devolve o número e o PDF oficial, conferido (valor,
 * vencimento e contribuinte no PDF). Qualquer diferença: para sem anexar.
 */
export async function emitirDareTo(cred: CredenciaisDareTo, pedido: PedidoDareTo, opcoes: { buscar?: Buscar; lerTextoPdf?: LerTextoPdf } = {}): Promise<DareEmitidoTo> {
  const s = new Sessao(opcoes.buscar ?? fetch);
  const lerTexto = opcoes.lerTextoPdf ?? textoDoPdfPadrao;
  const inicio = await entrar(s, cred);
  const { pagina, analise } = await abrirFormulario(s, inicio);
  if (!analise) throw new ErroDareTo("Não foi achado o formulário de emissão no sistema de DARE. Use “Testar conexão” nas configurações e emita pelo site.", "formulario");
  if (analise.faltando.length || analise.desconhecidos.length) {
    throw new ErroDareTo(
      `O formulário do DARE mudou (${[...analise.faltando.map((f) => `falta ${f}`), ...analise.desconhecidos.map((d) => `campo novo: ${d}`)].slice(0, 4).join("; ")}). Nada foi emitido: emita pelo site da SEFAZ-TO.`,
      "formulario",
    );
  }

  const valores = preencher(analise, pedido);
  let resp = await s.ir(analise.formulario.acao, { metodo: analise.formulario.metodo, corpo: montarEnvio(analise.formulario, valores, /emitir|gerar|salvar|confirmar|enviar|calcular/), referer: pagina.url });

  // Uma tela de confirmação (sem campos a preencher), quando houver
  if (!ehPdf(resp) && !numeroDoDare(textoVisivel(resp.html))) {
    const conf = lerFormularios(resp.html, resp.url).find(
      (f) =>
        f.campos.some((c) => c.tipo === "submit" && /confirmar|gerar|emitir/.test(normalizar(`${c.texto ?? ""} ${c.valor}`))) &&
        !f.campos.some((c) => !["hidden", "submit"].includes(c.tipo) && papelDoCampo(c)),
    );
    if (conf) resp = await s.ir(conf.acao, { metodo: conf.metodo, corpo: montarEnvio(conf, {}, /confirmar|gerar|emitir/), referer: resp.url });
  }

  if (!ehPdf(resp)) {
    const deNovo = melhorFormulario(resp);
    const msgs = mensagensDaPagina(resp.html);
    if (deNovo && deNovo.pontos >= analise.pontos - 1 && !numeroDoDare(textoVisivel(resp.html))) {
      throw new ErroDareTo(`A SEFAZ-TO não emitiu o DARE${msgs.length ? `: ${msgs.join(" ")}` : " (o formulário voltou sem número)."}`, "emissao");
    }
  }

  const numeroPagina = ehPdf(resp) ? null : numeroDoDare(textoVisivel(resp.html));
  const pdf = await buscarPdf(s, resp);
  if (!pdf) {
    throw new ErroDareTo(`${numeroPagina ? `O DARE nº ${numeroPagina} foi registrado na SEFAZ-TO, mas` : "A SEFAZ-TO"} não entregou o PDF. Baixe pelo site e anexe na empresa.`, "pdf");
  }

  let texto: string;
  try {
    texto = await lerTexto(pdf.bytes);
  } catch {
    throw new ErroDareTo(`${numeroPagina ? `O DARE nº ${numeroPagina}` : "O DARE"} foi gerado, mas o PDF não pôde ser conferido. Confira no site da SEFAZ-TO antes de usar.`, "pdf");
  }
  const digitos = soDigitos(texto);
  const valor = valorBr(pedido.valor);
  const contribuinteOk = (soDigitos(pedido.inscricaoEstadual) && digitos.includes(soDigitos(pedido.inscricaoEstadual))) || (soDigitos(pedido.documento) && digitos.includes(soDigitos(pedido.documento)));
  const problemas = [
    texto.includes(valor) ? "" : `valor R$ ${valor}`,
    texto.includes(dataBr(pedido.vencimento)) ? "" : `vencimento ${dataBr(pedido.vencimento)}`,
    contribuinteOk ? "" : "inscrição/CNPJ da empresa",
  ].filter(Boolean);
  const numero = numeroPagina ?? numeroDoDare(texto) ?? soDigitos(linhaDigitavelDoTexto(texto) ?? "");
  if (problemas.length) {
    throw new ErroDareTo(
      `O DARE${numero ? ` nº ${numero}` : ""} foi gerado, mas o PDF não confere (${problemas.join(", ")}). Ele não foi anexado: confira no site da SEFAZ-TO.`,
      "pdf",
    );
  }
  if (!numero || numero.length < 4) throw new ErroDareTo("O DARE foi gerado, mas o número não foi encontrado no PDF. Baixe pelo site e anexe na empresa.", "pdf");
  return { numero: numero.slice(0, 60), pdf: pdf.bytes, linhaDigitavel: linhaDigitavelDoTexto(texto) };
}
