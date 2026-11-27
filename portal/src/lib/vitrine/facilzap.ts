/**
 * Leitura do catálogo público de uma loja FácilZap (arquivos Markdown que a
 * própria plataforma publica: /catalogo.md, /categoria/<id>.md e
 * /produto/<id>.md). Só funções puras aqui; a busca na internet fica em
 * acoes-importacao.ts. Testado em tests/unit/vitrine-facilzap.test.ts.
 */

export interface CategoriaFz {
  id: string;
  nome: string;
  total: number;
}

export interface ProdutoListaFz {
  id: string;
  nome: string;
  preco: number;
  categoria: string;
}

export interface ProdutoFz {
  id: string;
  nome: string;
  preco: number | null;
  /** null quando a página não informa; 0 quando esgotado */
  estoque: number | null;
  categoria: string | null;
  sku: string | null;
  descricao: string | null;
  variacoes: string[];
  pesoKg: number | null;
  fotos: string[];
}

const preco = (t: string) => {
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Hosts de onde as fotos podem ser baixadas (servidores de arquivos da FácilZap). */
export const HOSTS_FOTOS = new Set(["arquivos.facilzap.app.br", "arquivos-cdn.facilzap.app.br"]);

export function ehCatalogoFacilZap(md: string): boolean {
  return /^# Catalogo de /m.test(md) && /\/produto\/\d+\.md\)/.test(md);
}

export function lerCatalogo(md: string): { loja: string | null; categorias: CategoriaFz[]; produtos: ProdutoListaFz[] } {
  const loja = /^# Catalogo de (.+)$/m.exec(md)?.[1]?.trim() ?? null;
  const categorias = [...md.matchAll(/^- \[(.+?)\]\([^)]*\/categoria\/(\d+)\.md\): (\d+) produtos?/gm)].map((m) => ({ nome: m[1].trim(), id: m[2], total: Number(m[3]) }));
  const vistos = new Set<string>();
  const produtos: ProdutoListaFz[] = [];
  for (const m of md.matchAll(/^- \[(.+?)\]\([^)]*\/produto\/(\d+)\.md\): R\$ ([\d.,]+) - (.+?)(?: - .*)?$/gm)) {
    if (vistos.has(m[2])) continue;
    vistos.add(m[2]);
    produtos.push({ id: m[2], nome: m[1].trim(), preco: preco(m[3]) ?? 0, categoria: m[4].trim() });
  }
  return { loja, categorias, produtos };
}

/** Produtos listados numa página de categoria e a categoria principal de cada um. */
export function lerCategoria(md: string): { nome: string | null; produtos: { id: string; principal: string }[] } {
  const nome = /^# (.+)$/m.exec(md)?.[1]?.trim() ?? null;
  const produtos = [...md.matchAll(/^- \[.+?\]\([^)]*\/produto\/(\d+)\.md\): R\$ [\d.,]+ - (.+?)(?: - .*)?$/gm)].map((m) => ({ id: m[1], principal: m[2].trim() }));
  return { nome, produtos };
}

/** Texto de uma seção "## Título" até a próxima seção (ou o fim). */
function secao(md: string, titulo: string): string | null {
  const m = new RegExp(`^## ${titulo}[ \\t]*$`, "m").exec(md);
  if (!m) return null;
  const resto = md.slice(m.index + m[0].length);
  const fim = resto.search(/^## /m);
  return (fim === -1 ? resto : resto.slice(0, fim)).trim();
}

export function lerProduto(md: string, id: string): ProdutoFz {
  const campo = (rotulo: string) => new RegExp(`^\\*\\*${rotulo}:\\*\\*\\s*(.+)$`, "m").exec(md)?.[1]?.trim() ?? null;
  const nome = /^# (.+)$/m.exec(md)?.[1]?.trim() ?? "";
  const disponibilidade = campo("Disponibilidade");
  let estoque: number | null = null;
  if (disponibilidade) {
    const q = /\((\d+)\s+unidades?\)/i.exec(disponibilidade);
    if (q) estoque = Number(q[1]);
    else if (/esgotad|indispon|sem estoque/i.test(disponibilidade)) estoque = 0;
  }
  const descricao = secao(md, "Descricao") || null;
  const variacoes = (/^- Variacoes:\s*(.+)$/m.exec(md)?.[1] ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const peso = /\|\s*Peso\s*\|\s*([\d.,]+)\s*(g|kg)\s*\|/i.exec(md);
  const pesoKg = peso ? (preco(peso[1]) ?? 0) / (peso[2].toLowerCase() === "kg" ? 1 : 1000) || null : null;
  const secaoImagens = secao(md, "Imagens") ?? "";
  const fotos = [...secaoImagens.matchAll(/^- (https:\/\/\S+)$/gm)]
    .map((m) => m[1])
    .filter((u) => {
      try {
        return HOSTS_FOTOS.has(new URL(u).hostname);
      } catch {
        return false;
      }
    });
  return {
    id,
    nome,
    preco: preco((campo("Preco a partir de") ?? campo("Preco") ?? "").replace(/^R\$\s*/, "")),
    estoque,
    categoria: campo("Categoria"),
    sku: campo("SKU"),
    descricao,
    variacoes: [...new Set(variacoes)],
    pesoKg,
    fotos: [...new Set(fotos)],
  };
}

/**
 * Subcategoria de cada produto: uma página de categoria é subcategoria da
 * categoria principal que mais aparece entre os produtos dela (ex.: "Bases"
 * dentro de "Maquiagens"). O produto fica na primeira subcategoria que tem a
 * mesma categoria principal dele.
 */
export function subcategorias(paginas: { nome: string; produtos: { id: string; principal: string }[] }[], principais: Set<string>): Map<string, string> {
  const resultado = new Map<string, string>();
  for (const p of paginas) {
    if (principais.has(p.nome) || !p.produtos.length) continue;
    const contagem = new Map<string, number>();
    for (const x of p.produtos) contagem.set(x.principal, (contagem.get(x.principal) ?? 0) + 1);
    const pai = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!pai || pai === p.nome) continue;
    for (const x of p.produtos) if (x.principal === pai && !resultado.has(x.id)) resultado.set(x.id, p.nome);
  }
  return resultado;
}

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "ou", "em", "com", "para", "por", "no", "na", "nos", "nas", "a", "o", "as", "os"]);

/**
 * Nome de vitrine: textos quase todos em maiúsculas viram "Primeira Letra
 * Maiúscula" (preposições em minúsculas; números e siglas de 2 letras ficam).
 * "BASE ALTA COBERTURA - BAUNY" → "Base Alta Cobertura - Bauny".
 */
export function nomeVitrine(texto: string): string {
  const t = texto.replace(/\s+/g, " ").trim();
  const letras = [...t].filter((c) => /\p{L}/u.test(c));
  if (!letras.length || letras.filter((c) => c === c.toLocaleUpperCase("pt-BR") && c !== c.toLocaleLowerCase("pt-BR")).length / letras.length < 0.7) return t;
  return t
    .split(" ")
    .map((w, i) => {
      if (/\d/.test(w)) return w.toLocaleUpperCase("pt-BR");
      const min = w.toLocaleLowerCase("pt-BR");
      if (i > 0 && MINUSCULAS.has(min)) return min;
      if (i > 0 && /^\p{L}{1,2}$/u.test(w)) return w;
      return min
        .split("-")
        .map((p) => p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1))
        .join("-");
    })
    .join(" ");
}

/** Sugestão de NCM pelo nome da categoria (só para as mais comuns; o escritório confere). */
export function sugestaoNcm(categoria: string): string {
  const c = categoria.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/prata|925/.test(c)) return "71131100";
  if (/aco|inox|bijuteria|semijoia/.test(c)) return "71171900";
  if (/maquiag|beauty|batom|base|cosmet|make/.test(c)) return "33049990";
  return "";
}
