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
