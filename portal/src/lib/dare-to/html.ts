/**
 * Leitura de páginas HTML do sistema de DARE da SEFAZ-TO sem biblioteca extra:
 * formulários (campos, rótulos, opções), links, mensagens e texto visível.
 * Feito para páginas de sistema (Rails), não para HTML arbitrário.
 */

export interface OpcaoCampo {
  valor: string;
  texto: string;
  selecionada: boolean;
}

export interface CampoFormulario {
  nome: string;
  /** text, password, hidden, select, textarea, date, number, email, checkbox, radio, submit... */
  tipo: string;
  id: string | null;
  rotulo: string;
  valor: string;
  obrigatorio: boolean;
  desabilitado: boolean;
  maxLength: number | null;
  opcoes: OpcaoCampo[];
  /** Texto do botão (submit). */
  texto?: string;
}

export interface FormularioHtml {
  acao: string;
  metodo: "GET" | "POST";
  campos: CampoFormulario[];
}

export interface LinkHtml {
  href: string;
  texto: string;
}

const ENTIDADES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ordm: "º",
  ordf: "ª",
  deg: "°",
};

export function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const k = e.toLowerCase();
    if (ENTIDADES[k]) return ENTIDADES[k];
    // &aacute; &ccedil; &atilde; ... → letra com acento
    const acento = /^([a-z])(acute|grave|circ|tilde|cedil|uml)$/i.exec(e);
    if (acento) {
      const marca = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", cedil: "̧", uml: "̈" }[acento[2].toLowerCase()]!;
      return (acento[1] + marca).normalize("NFC");
    }
    return m;
  });
}

/** Texto sem tags, com espaços normalizados. */
export function textoVisivel(html: string): string {
  return decodificar(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Minúsculas sem acento, para comparar rótulos. */
export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function atributos(tag: string): Record<string, string> {
  const r: Record<string, string> = {};
  const corpo = tag.replace(/^<\s*[a-z0-9]+/i, "").replace(/\/?>$/, "");
  for (const m of corpo.matchAll(/([^\s=/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    r[m[1].toLowerCase()] = decodificar(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return r;
}

function resolver(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Rótulos ligados por <label for="id">. */
function rotulosPorId(html: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const para = atributos(`<label${l[1]}>`).for;
    if (para) m.set(para, textoVisivel(l[2]));
  }
  return m;
}

/** Nome do campo legível: dare[valor_principal] → "valor principal". */
function nomeLegivel(nome: string): string {
  const ultimo = /\[([^\]]+)\]$/.exec(nome)?.[1] ?? nome;
  return ultimo.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Texto logo antes do campo (célula ou bloco anterior), quando não há <label>. */
function textoAntes(html: string, posicao: number): string {
  const antes = html.slice(Math.max(0, posicao - 400), posicao);
  const partes = antes.split(/<(?:input|select|textarea)\b[^>]*>|<\/(?:select|textarea)>/i);
  const t = textoVisivel(partes[partes.length - 1] ?? "");
  return t.length > 80 ? t.slice(-80) : t;
}

export function lerFormularios(html: string, base: string): FormularioHtml[] {
  const rotulos = rotulosPorId(html);
  const formularios: FormularioHtml[] = [];
  for (const f of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = atributos(`<form${f[1]}>`);
    const corpo = f[2];
    const inicioCorpo = (f.index ?? 0) + f[0].indexOf(">") + 1;
    const campos: CampoFormulario[] = [];
    const rotuloDe = (a: Record<string, string>, pos: number, envolvente: string | null) =>
      (a.id && rotulos.get(a.id)) || envolvente || a["aria-label"] || a.placeholder || a.title || textoAntes(html, inicioCorpo + pos) || nomeLegivel(a.name ?? "");

    // Rótulos que envolvem o campo: <label>Valor <input ...></label>
    const envolventes: { ini: number; fim: number; texto: string }[] = [];
    for (const l of corpo.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
      if (/<(input|select|textarea)\b/i.test(l[1])) {
        envolventes.push({ ini: l.index ?? 0, fim: (l.index ?? 0) + l[0].length, texto: textoVisivel(l[1].replace(/<(select|textarea)\b[\s\S]*?<\/\1>/gi, " ")) });
      }
    }
    const envolvente = (pos: number) => envolventes.find((e) => pos >= e.ini && pos <= e.fim)?.texto ?? null;

    for (const m of corpo.matchAll(/<input\b[^>]*>|<button\b[^>]*>[\s\S]*?<\/button>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi)) {
      const bruto = m[0];
      const tag = /^<[^>]*>/.exec(bruto)![0];
      const a = atributos(tag);
      const pos = m.index ?? 0;
      const nomeTag = /^<\s*([a-z]+)/i.exec(tag)![1].toLowerCase();
      const obrigatorio = "required" in a || a["aria-required"] === "true";
      const desabilitado = "disabled" in a;
      const maxLength = a.maxlength ? Number(a.maxlength) || null : null;
      if (nomeTag === "select") {
        if (!a.name) continue;
        const opcoes = [...bruto.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/select>|<\/option>)/gi)].map((o) => {
          const oa = atributos(`<option${o[1]}>`);
          const texto = textoVisivel(o[2]);
          return { valor: "value" in oa ? oa.value : texto, texto, selecionada: "selected" in oa };
        });
        const sel = opcoes.find((o) => o.selecionada) ?? opcoes[0];
        campos.push({ nome: a.name, tipo: "select", id: a.id ?? null, rotulo: rotuloDe(a, pos, envolvente(pos)), valor: sel?.valor ?? "", obrigatorio, desabilitado, maxLength, opcoes });
      } else if (nomeTag === "textarea") {
        if (!a.name) continue;
        const valor = decodificar(bruto.replace(/^<[^>]*>/, "").replace(/<\/textarea>$/i, ""));
        campos.push({ nome: a.name, tipo: "textarea", id: a.id ?? null, rotulo: rotuloDe(a, pos, envolvente(pos)), valor, obrigatorio, desabilitado, maxLength, opcoes: [] });
      } else if (nomeTag === "button") {
        const tipo = (a.type ?? "submit").toLowerCase();
        if (tipo !== "submit") continue;
        campos.push({ nome: a.name ?? "", tipo: "submit", id: a.id ?? null, rotulo: "", valor: a.value ?? "", obrigatorio: false, desabilitado, maxLength: null, opcoes: [], texto: textoVisivel(bruto) });
      } else {
        const tipo = (a.type ?? "text").toLowerCase();
        if (tipo === "submit" || tipo === "image") {
          campos.push({ nome: a.name ?? "", tipo: "submit", id: a.id ?? null, rotulo: "", valor: a.value ?? "", obrigatorio: false, desabilitado, maxLength: null, opcoes: [], texto: a.value ?? "" });
          continue;
        }
        if (!a.name || tipo === "button" || tipo === "reset" || tipo === "file") continue;
        const marcado = "checked" in a;
        if (tipo === "radio") {
          // Um campo por grupo: as opções são os botões; o valor é o marcado
          const opcao = { valor: a.value ?? "on", texto: rotuloDe(a, pos, envolvente(pos)), selecionada: marcado };
          const grupo = campos.find((c) => c.tipo === "radio" && c.nome === a.name);
          if (grupo) {
            grupo.opcoes.push(opcao);
            if (marcado) grupo.valor = opcao.valor;
            grupo.obrigatorio ||= obrigatorio;
          } else {
            campos.push({ nome: a.name, tipo, id: a.id ?? null, rotulo: textoAntes(html, inicioCorpo + pos) || nomeLegivel(a.name), valor: marcado ? opcao.valor : "", obrigatorio, desabilitado, maxLength, opcoes: [opcao] });
          }
          continue;
        }
        campos.push({
          nome: a.name,
          tipo,
          id: a.id ?? null,
          rotulo: tipo === "hidden" ? nomeLegivel(a.name) : rotuloDe(a, pos, envolvente(pos)),
          valor: tipo === "checkbox" ? (marcado ? (a.value ?? "on") : "") : (a.value ?? ""),
          obrigatorio,
          desabilitado,
          maxLength,
          opcoes: [],
        });
      }
    }
    formularios.push({ acao: resolver(attrs.action || base, base), metodo: (attrs.method ?? "get").toUpperCase() === "POST" ? "POST" : "GET", campos });
  }
  return formularios;
}

export function lerLinks(html: string, base: string): LinkHtml[] {
  const links: LinkHtml[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = atributos(`<a${m[1]}>`);
    const bruto = (a.href ?? "").trim();
    if (!bruto || bruto.startsWith("#") || /^(javascript|mailto|tel):/i.test(bruto)) continue;
    links.push({ href: resolver(bruto, base), texto: textoVisivel(m[2]) || a.title || a["aria-label"] || "" });
  }
  return links;
}

/** Mensagens de erro ou aviso que o sistema mostrou (flash do Rails, validações). */
export function mensagensDaPagina(html: string): string[] {
  const achadas: string[] = [];
  const padroes = [
    /<div\b[^>]*class="[^"]*\b(?:alert|flash|notice|error|erro|mensagem|aviso)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div\b[^>]*id="(?:error_explanation|flash[^"]*|erros?)"[^>]*>([\s\S]*?)<\/div>/gi,
    /<(?:span|small|p|li)\b[^>]*class="[^"]*\b(?:help-block|invalid-feedback|error|erro|text-danger)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|small|p|li)>/gi,
  ];
  for (const p of padroes) {
    for (const m of html.matchAll(p)) {
      const t = textoVisivel(m[1]).replace(/^[×x]\s*/, "");
      if (t && t.length <= 300 && !achadas.includes(t)) achadas.push(t);
    }
  }
  return achadas.slice(0, 5);
}

export function temCaptcha(html: string): boolean {
  return /g-recaptcha|grecaptcha|h-captcha|hcaptcha|cf-turnstile|captcha/i.test(html);
}

/** Título da página (para o mapeamento). */
export function tituloDaPagina(html: string): string {
  return textoVisivel(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 120);
}
