/**
 * Busca do portal (no navegador e no servidor), igual em todas as telas:
 * sem acento, sem diferença de maiúscula, com as palavras em qualquer ordem e
 * pela metade ("tab pin" acha "Tábua de pinus"); CPF, CNPJ, telefone e números
 * achados com ou sem pontuação.
 */

/**
 * Termo de busca seguro para filtros do PostgREST (.or / .ilike): remove
 * caracteres com significado especial na sintaxe de filtros.
 */
export function termoBusca(v: unknown, max = 80): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[,()*%\\:"'`;{}[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Lê um parâmetro de busca simples (string) da URL. */
export function parametro(sp: Record<string, string | string[] | undefined>, nome: string, permitidos?: readonly string[]): string {
  const v = sp[nome];
  const s = typeof v === "string" ? v : "";
  if (permitidos && !permitidos.includes(s)) return "";
  return s;
}

/** Minúsculo, sem acento, e pontuação (":", "-", "*", "/"...) vira espaço. Igual a app.busca_normalizar no banco. */
export function normalizarBusca(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Só número com pontuação ("123.456.789-00", "(63) 99999-0000", "1.234"). */
const SO_NUMERO = /^[\d\s.\-/()+]+$/;

/**
 * Palavras que a busca procura. Um número com pontuação (CPF, CNPJ, telefone,
 * número de nota) vira um número só; o resto vira palavras normalizadas.
 */
export function palavrasDaBusca(texto: unknown, max = 8): string[] {
  if (typeof texto !== "string") return [];
  const t = texto.trim().slice(0, 120);
  if (!t) return [];
  if (SO_NUMERO.test(t)) {
    const d = t.replace(/\D/g, "");
    return d ? [d] : [];
  }
  return [...new Set(normalizarBusca(t).split(" ").filter(Boolean))].slice(0, max);
}

type Parte = string | number | null | undefined;

/**
 * Texto em que a busca procura (no navegador): as partes normalizadas e, nas
 * que têm número, também sem a pontuação (para CPF, CNPJ, telefone e códigos).
 */
export function textoBuscavel(...partes: Parte[]): string {
  const ps = partes.filter((p): p is string | number => p != null && p !== "").map(String);
  const normal = ps.map(normalizarBusca);
  const colados = ps.filter((p) => /\d/.test(p)).map((p) => p.replace(/[^0-9A-Za-z]/g, "").toLowerCase());
  return [...normal, ...colados].join(" ");
}

/** O texto tem todas as palavras (em qualquer ordem). */
export function combinaBusca(alvo: string, palavras: string[]): boolean {
  if (!palavras.length) return true;
  const colado = alvo.replace(/ /g, "");
  return palavras.every((w) => alvo.includes(w) || colado.includes(w));
}

/**
 * Filtra uma lista que já está na tela. A ordem da lista é mantida, mas sobem
 * primeiro os itens cujo primeiro campo (o nome) começa com o que foi digitado
 * e, depois, os que têm todas as palavras no nome.
 */
export function filtrarLista<T>(lista: readonly T[], busca: string, campos: (item: T) => Parte[]): T[] {
  const palavras = palavrasDaBusca(busca);
  if (!palavras.length) return [...lista];
  const termo = palavras.join(" ");
  const achados: { item: T; nota: number; ordem: number }[] = [];
  lista.forEach((item, ordem) => {
    const partes = campos(item);
    if (!combinaBusca(textoBuscavel(...partes), palavras)) return;
    const nome = normalizarBusca(String(partes[0] ?? ""));
    const nota = nome.startsWith(termo) ? 0 : combinaBusca(nome, palavras) ? 1 : 2;
    achados.push({ item, nota, ordem });
  });
  achados.sort((a, b) => a.nota - b.nota || a.ordem - b.ordem);
  return achados.map((a) => a.item);
}

/**
 * Aplica a busca numa consulta do banco: cada palavra precisa estar no campo
 * "busca" da tabela (nome, CPF/CNPJ, telefone, número... já normalizados no
 * banco). Quem não vê a linha (RLS) continua sem vê-la.
 */
export function aplicarBusca<Q extends { ilike(coluna: "busca", padrao: string): Q }>(consulta: Q, busca: unknown): Q {
  let q = consulta;
  for (const p of palavrasDaBusca(busca)) q = q.ilike("busca", `%${p}%`);
  return q;
}

/** O item combina com a busca? Sem nada digitado, combina sempre. */
export function casaBusca(busca: string, ...partes: Parte[]): boolean {
  const palavras = palavrasDaBusca(busca);
  return !palavras.length || combinaBusca(textoBuscavel(...partes), palavras);
}

/**
 * A mesma busca como condição para usar dentro de um .or() do banco (ex.:
 * "achou pelo nome OU é tutor de um animal achado"). Sem nada digitado: null.
 */
export function condicaoBusca(busca: unknown): string | null {
  const ps = palavrasDaBusca(busca).map((p) => `busca.ilike.%${p}%`);
  if (!ps.length) return null;
  return ps.length === 1 ? ps[0] : `and(${ps.join(",")})`;
}
