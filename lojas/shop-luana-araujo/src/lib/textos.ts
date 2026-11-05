import type { NoCategoria } from "./catalogo";
import type { Loja } from "./tipos";

/** "Maquiagens, prata 925 e aço inoxidável" a partir das categorias com mais produtos. */
export function frasePrincipal(arvore: NoCategoria[]): string {
  const nomes = [...arvore].sort((a, b) => b.total - a.total).slice(0, 3).map((c) => c.nome);
  if (!nomes.length) return "";
  const lista = nomes.map((n, i) => (i === 0 ? n : n.toLocaleLowerCase("pt-BR")));
  return lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

export function descricaoLoja(loja: Loja, arvore: NoCategoria[]): string {
  const frase = frasePrincipal(arvore);
  const onde = loja.cidade ? ` em ${loja.cidade}` : "";
  return `${frase ? `${frase}${onde}. ` : ""}Escolha pelo site e finalize o pedido pelo WhatsApp da ${loja.nome}.`;
}
