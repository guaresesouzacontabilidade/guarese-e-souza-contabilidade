/**
 * Busca de produtos do caixa: acha pelo nome, código, grupo ou código de
 * barras com as palavras digitadas em qualquer ordem, sem ligar para acento,
 * maiúscula ou pontuação ("iphone 17 case" acha "CASE ... IPHONE:17PROMAX").
 */

export interface ProdutoBuscavel {
  codigo: string;
  descricao: string;
  gtin: string | null;
  grupo: string | null;
}

/** Minúsculo, sem acento, e pontuação (":", "-", "*", "/"...) vira espaço. */
export function normalizarBusca(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Produtos com todas as palavras digitadas, do mais parecido ao menos: código
 * ou código de barras exato, código que começa com o digitado, nome que começa
 * com o digitado, nome com todas as palavras e, por fim, as achadas no grupo.
 */
export function buscarProdutos<T extends ProdutoBuscavel>(produtos: T[], busca: string, limite = 30): { itens: T[]; total: number } {
  const bruto = busca.trim().toLowerCase();
  const termo = normalizarBusca(busca);
  if (!termo) return { itens: [], total: 0 };
  const palavras = termo.split(" ");
  const achados: { p: T; nota: number; ordem: number }[] = [];
  produtos.forEach((p, ordem) => {
    const codigo = p.codigo.toLowerCase();
    const nome = normalizarBusca(p.descricao);
    const tudo = `${nome} ${normalizarBusca(p.codigo)} ${normalizarBusca(p.grupo ?? "")} ${p.gtin ?? ""}`;
    const colado = tudo.replace(/ /g, "");
    if (!palavras.every((w) => tudo.includes(w) || colado.includes(w))) return;
    const nomeColado = nome.replace(/ /g, "");
    const nota =
      codigo === bruto || p.gtin === bruto
        ? 0
        : codigo.startsWith(bruto)
          ? 1
          : nome.startsWith(termo)
            ? 2
            : palavras.every((w) => nome.includes(w) || nomeColado.includes(w))
              ? 3
              : 4;
    achados.push({ p, nota, ordem });
  });
  achados.sort((a, b) => a.nota - b.nota || a.ordem - b.ordem);
  return { itens: achados.slice(0, limite).map((a) => a.p), total: achados.length };
}
