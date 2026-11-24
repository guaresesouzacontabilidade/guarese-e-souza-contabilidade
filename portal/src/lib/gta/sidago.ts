import { createHash } from "node:crypto";
import { atributos, decodificar, textoVisivel } from "@/lib/dare-to/html";

/**
 * Robô da GTA no SIDAGO (Agrodefesa, Goiás) em MODO CONFERÊNCIA.
 *
 * O caminho é o de uma pessoa no navegador, sem navegador (conversa direta com
 * o site, como o robô do DARE-TO):
 *  1. login com o usuário e a senha do produtor: o site pede uma "semente"
 *     (application/index/charque) e recebe o login com a senha em MD5 e a
 *     semente (application/index/autenticacao), como faz o próprio site;
 *  2. na página inicial, procura os links da GTA (Guia de Trânsito Animal) e
 *     abre só páginas de consulta e de formulário (GET) — nunca links de
 *     excluir, cancelar, gravar ou emitir;
 *  3. escolhe a página com o formulário da GTA (a que tem mais campos como
 *     finalidade, destino, espécie, sexo, idade, quantidade, placa, nota);
 *  4. lê os campos (rótulo, nome, tipo e opções) e casa com os dados do pedido:
 *     o que iria em cada campo, o que não achou e a opção escolhida em cada
 *     lista.
 * NADA é enviado ao SIDAGO além do login: a GTA não é emitida. O resultado
 * guarda só a estrutura do formulário e os valores do pedido (sem senha e sem
 * a página inteira), para conferir e para ajustar o robô se o site mudar.
 */
export const BASE_SIDAGO = "https://sidago.agrodefesa.go.gov.br/";
const AGENTE = "Mozilla/5.0 (compatible; PortalGuaresesON/1.0; modo-conferencia)";
/** Links que nunca são abertos (podem mudar algo no SIDAGO só por abrir). */
const PERIGOSO = /excluir|exclus|cancel|apagar|remover|deletar|estorn|desativ|inativ|gravar|salvar|confirmar|finalizar|assinar|logout|sair|baixar|imprimir|\.pdf/i;
const GTA = /gta|guia\s+de\s+tr[aâ]nsito/i;
const MAX_PAGINAS = 8;

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export class ErroSidago extends Error {
  constructor(
    mensagem: string,
    readonly etapa: "conexao" | "login" | "formulario" = "conexao",
  ) {
    super(mensagem);
  }
}

export interface AnimalGta {
  sexo: "macho" | "femea";
  faixa: "0-12" | "13-24" | "25-36" | "36+";
  quantidade: number;
}

export interface PedidoGta {
  origemIe: string | null;
  origemNome: string | null;
  destinoNome: string;
  destinoDocumento: string | null;
  destinoIe: string | null;
  destinoMunicipio: string | null;
  destinoCodigo: string | null;
  finalidade: string;
  especie: string;
  animais: AnimalGta[];
  totalAnimais: number;
  transporte: string;
  placa: string | null;
  placaUf: string | null;
  transportadorNome: string | null;
  transportadorDocumento: string | null;
  dataSaida: string;
  nfNumero: number | null;
  nfSerie: number | null;
  nfChave: string | null;
}

export interface CampoSidago {
  nome: string;
  id: string;
  tipo: string;
  rotulo: string;
  opcoes?: string[];
}

export interface ItemConferencia {
  dado: string;
  valor: string;
  campo: string | null;
  opcao: string | null;
  situacao: "encontrado" | "opcao_nao_encontrada" | "campo_nao_encontrado";
}

export interface ResultadoConferencia {
  login: "ok";
  /** Links da GTA achados na página inicial. */
  menu: { texto: string; caminho: string }[];
  /** Outros links seguros da página inicial (para ajustar o robô quando o menu da GTA não aparece). */
  links: { texto: string; caminho: string }[];
  paginas: { caminho: string; titulo: string; pontos: number }[];
  formulario: { caminho: string; titulo: string; campos: CampoSidago[] } | null;
  itens: ItemConferencia[];
}

// -----------------------------------------------------------------------------
// Sessão (cookies) e chamadas
// -----------------------------------------------------------------------------
class Sessao {
  private cookies = new Map<string, string>();
  constructor(private readonly buscar: Buscar) {}

  private guardar(r: Response) {
    const lista = (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? (r.headers.get("set-cookie") ? [r.headers.get("set-cookie")!] : []);
    for (const c of lista) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  async pedir(caminho: string, init: RequestInit = {}, seguir = 3): Promise<{ status: number; url: string; texto: string }> {
    const url = new URL(caminho, BASE_SIDAGO).toString();
    if (!url.startsWith(BASE_SIDAGO)) throw new ErroSidago("Endereço fora do SIDAGO.");
    let r: Response;
    try {
      r = await this.buscar(url, {
        ...init,
        redirect: "manual",
        headers: {
          "User-Agent": AGENTE,
          Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
          ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: init.signal ?? AbortSignal.timeout(25_000),
      });
    } catch {
      throw new ErroSidago("O SIDAGO não respondeu. Tente de novo em alguns minutos.");
    }
    this.guardar(r);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location") && seguir > 0) {
      return this.pedir(new URL(r.headers.get("location")!, url).toString(), { method: "GET" }, seguir - 1);
    }
    return { status: r.status, url, texto: await r.text() };
  }
}

/** Resposta do SIDAGO no formato de lista ("['ok', ...]" ou JSON). */
export function lerLista(texto: string): unknown[] | null {
  const t = texto.trim();
  for (const tentativa of [t, t.replace(/'/g, '"')]) {
    try {
      const v = JSON.parse(tentativa);
      if (Array.isArray(v)) return v;
    } catch {
      /* tenta o próximo formato */
    }
  }
  return null;
}

const MENSAGENS_LOGIN: Record<string, string> = {
  mudarSenha: "O SIDAGO pede a troca da senha deste usuário. Entre no SIDAGO, troque a senha e cadastre a nova aqui.",
  usuarioBloqueado: "O SIDAGO informou que o usuário está bloqueado.",
  emailRepetido: "O SIDAGO bloqueou o acesso por e-mail repetido em outros cadastros: entre pelo gov.br ou procure a Agrodefesa para atualizar o e-mail.",
  confirmarSenhaAdministrador: "O SIDAGO pede uma confirmação de administrador para este usuário.",
  escolherLotacaoEspecial: "Este usuário é de servidor da Agrodefesa (pede lotação): use o login do produtor.",
};

async function entrar(s: Sessao, login: string, senha: string) {
  await s.pedir("application/index/login");
  const semente = await s.pedir("application/index/charque", { method: "POST", headers: { "X-Requested-With": "XMLHttpRequest" }, body: "" });
  const lista = lerLista(semente.texto);
  const seed = Array.isArray(lista?.[1]) ? String((lista![1] as unknown[])[1] ?? "") : "";
  if (lista?.[0] !== "ok" || !seed) throw new ErroSidago("O SIDAGO não abriu a tela de login (sem resposta da semente). Tente de novo mais tarde.");
  const corpo = new URLSearchParams({
    password: createHash("md5").update(senha, "utf8").digest("hex"),
    password_raw: senha,
    seed,
    login,
    coordenada: "",
  });
  const r = await s.pedir("application/index/autenticacao", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
    body: corpo.toString(),
  });
  const res = lerLista(r.texto);
  if (res && res[0] === "erro") {
    const motivo = String(res[1] ?? "");
    throw new ErroSidago(MENSAGENS_LOGIN[motivo] ?? `O SIDAGO recusou o login: ${textoVisivel(motivo).slice(0, 200) || "usuário ou senha inválidos"}.`, "login");
  }
  if (res && ["email", "usuário sem email cadastrado", "usuário sem email verificado"].includes(String(res[1]))) {
    throw new ErroSidago("O SIDAGO pede um e-mail para este usuário antes de entrar. Entre uma vez no SIDAGO, informe o e-mail e tente de novo.", "login");
  }
  const inicio = await s.pedir("application/index/index");
  if (/id=["']senha["']/.test(inicio.texto) && /EfetuarLogin|nti\.login\(/.test(inicio.texto)) {
    throw new ErroSidago("O SIDAGO não aceitou o login (voltou para a tela de entrada). Confira o usuário e a senha.", "login");
  }
  return inicio;
}

// -----------------------------------------------------------------------------
// Leitura das páginas
// -----------------------------------------------------------------------------
function semAcento(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Links do SIDAGO que podem ser abertos só para ler (nunca os que mudam algo). */
export function linksSeguros(html: string, filtro?: RegExp): { texto: string; caminho: string }[] {
  const vistos = new Set<string>();
  const r: { texto: string; caminho: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = atributos(m[0].slice(0, m[0].indexOf(">") + 1)).href ?? "";
    const texto = textoVisivel(m[1]).slice(0, 120);
    if (!href || href.startsWith("#") || /^javascript:|^mailto:/i.test(href)) continue;
    if ((filtro && !filtro.test(`${texto} ${href}`)) || PERIGOSO.test(`${texto} ${href}`)) continue;
    let caminho: string;
    try {
      const u = new URL(decodificar(href), BASE_SIDAGO);
      if (!u.toString().startsWith(BASE_SIDAGO)) continue;
      caminho = u.pathname + u.search;
    } catch {
      continue;
    }
    if (vistos.has(caminho)) continue;
    vistos.add(caminho);
    r.push({ texto, caminho });
  }
  return r;
}

export function linksGta(html: string) {
  return linksSeguros(html, GTA);
}

/** Campos de formulário com o rótulo (label for, label em volta, placeholder ou o texto antes). */
export function lerCampos(html: string): CampoSidago[] {
  const rotulos = new Map<string, string>();
  for (const m of html.matchAll(/<label\b[^>]*for=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi)) rotulos.set(m[1], textoVisivel(m[2]));
  const campos: CampoSidago[] = [];
  const vistos = new Set<string>();
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const a = atributos(tag);
    const tipo = m[1].toLowerCase() === "input" ? (a.type ?? "text").toLowerCase() : m[1].toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "password", "file"].includes(tipo)) continue;
    const nome = a.name ?? "";
    const id = a.id ?? "";
    if (!nome && !id) continue;
    const chave = `${nome}|${id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    let rotulo = (id && rotulos.get(id)) || a.placeholder || a.title || "";
    if (!rotulo) {
      // texto visível logo antes do campo (layout em tabela ou div)
      const pedacos = html
        .slice(Math.max(0, (m.index ?? 0) - 400), m.index ?? 0)
        .split(/<[^>]*>/)
        .map((t) => textoVisivel(t).replace(/:\s*$/, ""))
        .filter(Boolean);
      rotulo = pedacos.pop()?.slice(-60) ?? "";
    }
    const campo: CampoSidago = { nome, id, tipo, rotulo: rotulo.slice(0, 80) };
    if (tipo === "select") {
      const ini = (m.index ?? 0) + tag.length;
      const fim = html.toLowerCase().indexOf("</select>", ini);
      const miolo = html.slice(ini, fim < 0 ? ini : fim);
      campo.opcoes = [...miolo.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map((o) => textoVisivel(o[1])).filter(Boolean).slice(0, 60);
    }
    campos.push(campo);
  }
  return campos;
}

const PISTAS = ["finalidade", "destino", "especie", "sexo", "idade", "faixa", "quantidade", "placa", "veiculo", "transporte", "nota", "origem", "propriedade", "exploracao", "estabelecimento", "municipio"];

export function pontosGta(campos: CampoSidago[]): number {
  const texto = semAcento(campos.map((c) => `${c.rotulo} ${c.nome} ${c.id}`).join(" "));
  return PISTAS.filter((p) => texto.includes(p)).length;
}

// -----------------------------------------------------------------------------
// O que iria em cada campo
// -----------------------------------------------------------------------------
const FINALIDADES: Record<string, string> = {
  abate: "Abate",
  engorda: "Engorda",
  recria: "Recria",
  reproducao: "Reprodução",
  cria: "Cria",
  exposicao: "Exposição",
  leilao: "Leilão",
  outra: "Outra",
};
const FAIXAS: Record<string, string> = { "0-12": "0 a 12 meses", "13-24": "13 a 24 meses", "25-36": "25 a 36 meses", "36+": "acima de 36 meses" };

/** Chave: um texto, ou uma lista de textos que precisam aparecer juntos no rótulo do campo. */
type Chave = string | string[];

function acharCampo(campos: CampoSidago[], chaves: Chave[]): CampoSidago | null {
  for (const k of chaves) {
    const partes = Array.isArray(k) ? k : [k];
    const c = campos.find((x) => {
      const t = semAcento(`${x.rotulo} ${x.nome} ${x.id}`);
      return partes.every((p) => t.includes(p));
    });
    if (c) return c;
  }
  return null;
}

/** Como a faixa de idade costuma aparecer no rótulo ("Machos 13 a 24 meses", "Fêmeas acima de 36"). */
const PISTAS_FAIXA: Record<AnimalGta["faixa"], string[][]> = {
  "0-12": [["0", "12"], ["ate 12"]],
  "13-24": [["13", "24"]],
  "25-36": [["25", "36"]],
  "36+": [["acima"], ["mais de 36"], ["36+"], [">36"]],
};

function acharOpcao(campo: CampoSidago, valor: string): string | null {
  const alvo = semAcento(valor).trim();
  if (!alvo) return null;
  return (
    campo.opcoes?.find((o) => {
      const op = semAcento(o).trim();
      return op.includes(alvo) || (op.length >= 3 && alvo.includes(op));
    }) ?? null
  );
}

export function conferir(campos: CampoSidago[], p: PedidoGta): ItemConferencia[] {
  const itens: ItemConferencia[] = [];
  const item = (dado: string, valor: string | null | undefined, chaves: Chave[], opcaoDe?: string) => {
    if (!valor) return;
    const campo = acharCampo(campos, chaves);
    if (!campo) {
      itens.push({ dado, valor, campo: null, opcao: null, situacao: "campo_nao_encontrado" });
      return;
    }
    const nomeCampo = campo.rotulo || campo.nome || campo.id;
    if (campo.tipo === "select") {
      const opcao = acharOpcao(campo, opcaoDe ?? valor);
      itens.push({ dado, valor, campo: nomeCampo, opcao, situacao: opcao ? "encontrado" : "opcao_nao_encontrada" });
    } else {
      itens.push({ dado, valor, campo: nomeCampo, opcao: null, situacao: "encontrado" });
    }
  };
  item("Origem (inscrição estadual)", p.origemIe, ["inscricao", "origem", "propriedade", "exploracao"]);
  item("Espécie", p.especie === "bovina" ? "Bovina" : p.especie, ["especie"], p.especie === "bovina" ? "bovin" : p.especie);
  item("Finalidade", FINALIDADES[p.finalidade] ?? p.finalidade, ["finalidade"]);
  item("Destino", p.destinoNome, ["destino", "destinatario", "estabelecimento"]);
  item("CPF/CNPJ do destino", p.destinoDocumento, ["cpf", "cnpj", "documento"]);
  item("Código do destino (SIDAGO/SIF)", p.destinoCodigo, ["codigo", "sif", "registro"]);
  item("Município de destino", p.destinoMunicipio, ["municipio", "cidade"]);
  for (const a of p.animais) {
    const sexo = a.sexo === "macho" ? "macho" : "femea";
    item(`${a.sexo === "macho" ? "Machos" : "Fêmeas"} ${a.faixa === "36+" ? "" : "de "}${FAIXAS[a.faixa]}`, String(a.quantidade), [
      ...PISTAS_FAIXA[a.faixa].map((f) => [sexo, ...f]),
      sexo,
      "quantidade",
    ]);
  }
  item("Total de animais", String(p.totalAnimais), ["total", "quantidade"]);
  item("Transporte", p.transporte === "rodoviario" ? "Rodoviário" : p.transporte, ["transporte", "meio"]);
  item("Placa", p.placa ? `${p.placa}${p.placaUf ? ` (${p.placaUf})` : ""}` : null, ["placa", "veiculo"]);
  item("Transportador", p.transportadorNome, ["transportador", "motorista", "condutor"]);
  item("Data de saída", p.dataSaida.split("-").reverse().join("/"), ["data", "saida", "previs"]);
  item("Nota fiscal", p.nfNumero ? `${p.nfNumero}${p.nfSerie ? ` série ${p.nfSerie}` : ""}` : null, ["nota", "nf", "fiscal"]);
  item("Chave da NF-e", p.nfChave, ["chave"]);
  return itens;
}

// -----------------------------------------------------------------------------
// Conferência completa
// -----------------------------------------------------------------------------
export async function conferirNoSidago(acesso: { login: string; senha: string }, pedido: PedidoGta, buscar: Buscar = fetch): Promise<ResultadoConferencia> {
  const s = new Sessao(buscar);
  const inicio = await entrar(s, acesso.login, acesso.senha);
  const menu = linksGta(inicio.texto);
  const paginas: ResultadoConferencia["paginas"] = [];
  let melhor: { caminho: string; titulo: string; campos: CampoSidago[]; pontos: number } | null = null;
  const fila = [...menu.map((m) => m.caminho)];
  const abertas = new Set<string>();
  while (fila.length && abertas.size < MAX_PAGINAS) {
    const caminho = fila.shift()!;
    if (abertas.has(caminho)) continue;
    abertas.add(caminho);
    const pg = await s.pedir(caminho);
    if (pg.status >= 400) continue;
    const campos = lerCampos(pg.texto);
    const pontos = pontosGta(campos);
    const titulo = textoVisivel(/<title>([\s\S]*?)<\/title>/i.exec(pg.texto)?.[1] ?? "").slice(0, 120) || /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(pg.texto)?.[1]?.replace(/<[^>]+>/g, "").trim().slice(0, 120) || caminho;
    paginas.push({ caminho, titulo, pontos });
    if (!melhor || pontos > melhor.pontos) melhor = { caminho, titulo, campos, pontos };
    // Um nível a mais: links de GTA dentro da página (ex.: "Nova GTA")
    for (const l of linksGta(pg.texto)) if (!abertas.has(l.caminho)) fila.push(l.caminho);
  }
  const formulario = melhor && melhor.pontos >= 3 ? { caminho: melhor.caminho, titulo: melhor.titulo, campos: melhor.campos } : null;
  // O resultado guarda os endereços sem os parâmetros (podem ter códigos da sessão ou do produtor)
  const sem = (c: string) => c.split("?")[0];
  const links = linksSeguros(inicio.texto)
    .filter((l) => !menu.some((m) => m.caminho === l.caminho))
    .map((l) => ({ texto: l.texto, caminho: sem(l.caminho) }))
    .slice(0, 40);
  return {
    login: "ok",
    menu: menu.slice(0, 30).map((m) => ({ texto: m.texto, caminho: sem(m.caminho) })),
    links,
    paginas: paginas.map((p) => ({ ...p, caminho: sem(p.caminho) })),
    formulario: formulario ? { ...formulario, caminho: sem(formulario.caminho) } : null,
    itens: formulario ? conferir(formulario.campos, pedido) : [],
  };
}
