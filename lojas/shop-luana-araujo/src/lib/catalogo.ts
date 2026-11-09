/** Regras do catálogo sem dependência de servidor ou navegador (testadas em tests/catalogo.test.ts). */
import type { Categoria, Entrega, FormaPagamento, PedidoRegistrado, ProdutoResumo } from "./tipos";

/** Minúsculas e sem acento, para busca e comparação. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function slug(texto: string): string {
  return normalizar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "produto";
}

const moedaBR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function moeda(valor: number): string {
  return moedaBR.format(valor).replace(/ /g, " ");
}

export const urlProduto = (p: Pick<ProdutoResumo, "id" | "nome">) => `/p/${p.id}/${slug(p.nome)}`;
export const urlCategoria = (c: Pick<Categoria, "slug">) => `/c/${c.slug}`;

/** Busca por palavras em qualquer ordem, sem acento ("brinco prata" acha "Brinco Argola Prata 925"). */
export function buscar<T extends Pick<ProdutoResumo, "nome">>(produtos: T[], termo: string): T[] {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  return produtos.filter((p) => {
    const nome = normalizar(p.nome);
    return palavras.every((w) => nome.includes(w));
  });
}

export type Ordem = "destaque" | "novos" | "menor" | "maior" | "az";
export const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "destaque", rotulo: "Em destaque" },
  { valor: "novos", rotulo: "Novidades" },
  { valor: "menor", rotulo: "Menor preço" },
  { valor: "maior", rotulo: "Maior preço" },
  { valor: "az", rotulo: "Nome (A–Z)" },
];

/** Ordena; os esgotados vão sempre para o fim e, em "destaque" e "novidades", os sem foto ficam depois dos com foto. */
export function ordenar<T extends ProdutoResumo>(produtos: T[], ordem: Ordem): T[] {
  const nome = (a: T, b: T) => a.nome.localeCompare(b.nome, "pt-BR");
  const novos = (a: T, b: T) => b.publicado_em.localeCompare(a.publicado_em);
  const regra: Record<Ordem, (a: T, b: T) => number> = {
    destaque: (a, b) => Number(b.destaque) - Number(a.destaque) || novos(a, b),
    novos,
    menor: (a, b) => a.preco - b.preco || nome(a, b),
    maior: (a, b) => b.preco - a.preco || nome(a, b),
    az: nome,
  };
  const comFoto = (p: T) => (ordem === "destaque" || ordem === "novos" ? Number(p.fotos.length > 0) : 0);
  return [...produtos].sort((a, b) => Number(b.disponivel) - Number(a.disponivel) || comFoto(b) - comFoto(a) || regra[ordem](a, b));
}

export interface NoCategoria extends Categoria {
  filhas: NoCategoria[];
  /** Produtos da categoria e das subcategorias */
  total: number;
}

/**
 * Árvore de categorias com a contagem de produtos; só entram as que têm produto.
 * Ordem: as numeradas no portal (1, 2, 3…) primeiro; as demais (ordem 0, como
 * as importadas), das com mais produtos para as com menos, depois pelo nome.
 */
export function arvoreCategorias(categorias: Categoria[], produtos: Pick<ProdutoResumo, "categoria_id">[]): NoCategoria[] {
  const porCategoria = new Map<string, number>();
  for (const p of produtos) if (p.categoria_id) porCategoria.set(p.categoria_id, (porCategoria.get(p.categoria_id) ?? 0) + 1);
  const posicao = (c: NoCategoria) => (c.ordem > 0 ? c.ordem : Number.MAX_SAFE_INTEGER);
  const ordem = (a: NoCategoria, b: NoCategoria) => posicao(a) - posicao(b) || b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR");
  return categorias
    .filter((c) => !c.pai_id)
    .map((r) => {
      const filhas = categorias
        .filter((c) => c.pai_id === r.id)
        .map((f) => ({ ...f, filhas: [], total: porCategoria.get(f.id) ?? 0 }))
        .filter((f) => f.total > 0)
        .sort(ordem);
      return { ...r, filhas, total: (porCategoria.get(r.id) ?? 0) + filhas.reduce((s, f) => s + f.total, 0) };
    })
    .filter((r) => r.total > 0)
    .sort(ordem);
}

/** Acha a categoria pelo endereço e devolve também a principal (quando é subcategoria). */
export function acharCategoria(arvore: NoCategoria[], endereco: string): { categoria: NoCategoria; pai: NoCategoria | null } | null {
  for (const r of arvore) {
    if (r.slug === endereco) return { categoria: r, pai: null };
    const f = r.filhas.find((x) => x.slug === endereco);
    if (f) return { categoria: f, pai: r };
  }
  return null;
}

export function produtosDaCategoria<T extends Pick<ProdutoResumo, "categoria_id">>(no: NoCategoria, produtos: T[]): T[] {
  const ids = new Set([no.id, ...no.filhas.map((f) => f.id)]);
  return produtos.filter((p) => p.categoria_id && ids.has(p.categoria_id));
}

export function valorEntrega(e: Entrega): string {
  if (e.valor === null) return "A combinar";
  if (e.valor === 0) return "Grátis";
  return moeda(e.valor);
}

export const ROTULO_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: "PIX",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  dinheiro: "Dinheiro",
};

/** "(63) 99208-8810" a partir de "5563992088810". */
export function telefoneVisivel(numero: string): string {
  const d = numero.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numero;
}

export function cnpjVisivel(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : cnpj;
}

export function linkWhatsApp(numero: string, texto?: string): string {
  const n = numero.replace(/\D/g, "");
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

/** Mensagem do pedido para o WhatsApp da loja (o mesmo pedido já está no portal com este número). */
export function mensagemPedido(p: PedidoRegistrado): string {
  const linhas = p.itens.map((i) => {
    const opcao = i.variacao ? ` (${i.rotulo_variacao}: ${i.variacao})` : "";
    return `• ${i.quantidade}x ${i.nome}${opcao} — ${moeda(i.total)}`;
  });
  const frete = p.frete_a_combinar ? "a combinar" : p.frete === 0 ? "grátis" : moeda(p.frete);
  return [
    `Olá! Fiz o pedido nº ${p.numero} pelo site.`,
    "",
    ...linhas,
    "",
    `Produtos: ${moeda(p.subtotal)}`,
    `Entrega: ${p.entrega} (${frete})`,
    `Total: ${moeda(p.total)}${p.frete_a_combinar ? " + frete" : ""}`,
    "",
    `Pagamento: ${p.pagamento}${p.troco_para ? ` (troco para ${moeda(p.troco_para)})` : ""}`,
    ...(p.endereco ? [`Endereço: ${p.endereco}`] : []),
    `Nome: ${p.nome}`,
  ].join("\n");
}
