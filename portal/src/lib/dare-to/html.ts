/**
 * Leitura de páginas HTML do DARE avulso da SEFAZ-TO sem biblioteca extra:
 * entidades, texto visível e atributos de uma tag.
 */

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

/** Atributos de uma tag (<input name="x" value='y' required>). */
export function atributos(tag: string): Record<string, string> {
  const r: Record<string, string> = {};
  const corpo = tag.replace(/^<\s*[a-z0-9]+/i, "").replace(/\/?>$/, "");
  for (const m of corpo.matchAll(/([^\s=/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    r[m[1].toLowerCase()] = decodificar(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return r;
}
