import "server-only";
import { readFile } from "node:fs/promises";
import type { DadosPedido, PedidoRegistrado, ProdutoDetalhe, Vitrine } from "./tipos";

/**
 * Ligação com o Portal Guarese's ON. O site não tem banco: o catálogo, o estoque
 * e os pedidos ficam no portal. Toda chamada leva a chave do site, que só existe
 * no servidor (variável PORTAL_CHAVE, nunca exposta ao navegador).
 *
 * O catálogo fica guardado por até 60 segundos: com muitas ou poucas visitas, o
 * portal recebe no máximo uma consulta por minuto por página.
 *
 * Demonstração: com VITRINE_DEMO apontando para um arquivo JSON local, o site
 * mostra esses dados e não fala com o portal (só para testes e capturas de tela).
 */

export const REVALIDAR_SEGUNDOS = 60;

function config() {
  const url = process.env.PORTAL_URL?.replace(/\/$/, "");
  const slug = process.env.LOJA_SLUG;
  const chave = process.env.PORTAL_CHAVE;
  if (!url || !slug || !chave) {
    throw new Error("Configure PORTAL_URL, LOJA_SLUG e PORTAL_CHAVE (veja o LEIA-ME).");
  }
  return { url, slug, chave };
}

export const emDemonstracao = () => Boolean(process.env.VITRINE_DEMO);

interface Demo extends Vitrine {
  detalhes: Record<string, ProdutoDetalhe>;
}
async function demo(): Promise<Demo> {
  return JSON.parse(await readFile(process.env.VITRINE_DEMO as string, "utf8")) as Demo;
}

/** Endereço de uma foto no armazenamento do portal → mesmo caminho em /fotos do próprio site. */
function pelaRotaDeFotos(foto: string): string {
  const origem = process.env.FOTOS_URL?.replace(/\/$/, "");
  const prefixo = origem ? `${origem}/storage/v1/object/public/loja-site/` : null;
  return prefixo && foto.startsWith(prefixo) ? `/fotos/${foto.slice(prefixo.length)}` : foto;
}

function pelasFotosDoSite<T extends { fotos?: string[] }>(item: T): T {
  return item.fotos ? { ...item, fotos: item.fotos.map(pelaRotaDeFotos) } : item;
}

async function pedirAoPortal<T>(caminho: string, init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }): Promise<T | null> {
  const { url, slug, chave } = config();
  const r = await fetch(`${url}/api/vitrine/${encodeURIComponent(slug)}${caminho}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${chave}`, accept: "application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Portal respondeu ${r.status} em ${caminho || "/"}`);
  return (await r.json()) as T;
}

/** Catálogo completo (sem descrições): loja, categorias e produtos visíveis. */
export async function obterVitrine(): Promise<Vitrine> {
  if (emDemonstracao()) {
    const d = await demo();
    return { aberta: d.aberta, loja: d.loja, banners: d.banners ?? [], categorias: d.categorias, produtos: d.produtos };
  }
  const v = await pedirAoPortal<Vitrine>("", { next: { revalidate: REVALIDAR_SEGUNDOS, tags: ["vitrine"] } });
  if (!v) throw new Error("Loja não encontrada no portal: confira LOJA_SLUG e PORTAL_CHAVE.");
  return {
    ...v,
    banners: (v.banners ?? []).map((b) => ({ ...b, computador: pelaRotaDeFotos(b.computador), celular: pelaRotaDeFotos(b.celular) })),
    produtos: (v.produtos ?? []).map(pelasFotosDoSite),
  };
}

/** Produto com descrição, todas as fotos e as variações. */
export async function obterProduto(id: string): Promise<ProdutoDetalhe | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  if (emDemonstracao()) return (await demo()).detalhes[id] ?? null;
  const p = await pedirAoPortal<ProdutoDetalhe>(`/produtos/${id}`, { next: { revalidate: REVALIDAR_SEGUNDOS, tags: ["vitrine", `produto:${id}`] } });
  return p ? pelasFotosDoSite(p) : null;
}

export type RespostaPedido = { ok: true; pedido: PedidoRegistrado } | { ok: false; mensagem: string; precosMudaram?: boolean };

/** Envia o pedido ao portal (vira orçamento "site" na loja). Nunca guardado em cache. */
export async function enviarPedido(dados: DadosPedido, ipCliente: string): Promise<RespostaPedido> {
  if (emDemonstracao()) return pedidoDemonstracao(dados);
  const { url, slug, chave } = config();
  const r = await fetch(`${url}/api/vitrine/${encodeURIComponent(slug)}/pedidos`, {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-cliente-ip": ipCliente },
    body: JSON.stringify(dados),
  });
  const corpo = (await r.json().catch(() => null)) as RespostaPedido | null;
  if (corpo && typeof corpo === "object" && "ok" in corpo) return corpo;
  return { ok: false, mensagem: "Não conseguimos registrar o pedido agora. Tente de novo em instantes ou fale com a loja pelo WhatsApp." };
}

async function pedidoDemonstracao(dados: DadosPedido): Promise<RespostaPedido> {
  const d = await demo();
  const entrega = d.loja.entregas.find((e) => e.id === dados.entrega);
  if (!entrega) return { ok: false, mensagem: "Escolha a forma de entrega." };
  const itens = dados.itens.map((i) => {
    const p = d.detalhes[i.produto_id] ?? d.produtos.find((x) => x.id === i.produto_id);
    const preco = p?.preco ?? 0;
    return {
      nome: p?.nome ?? "Produto",
      quantidade: i.quantidade,
      preco,
      total: Math.round(preco * i.quantidade * 100) / 100,
      variacao: i.variacao ?? null,
      rotulo_variacao: (p && "rotulo_variacao" in p ? p.rotulo_variacao : null) ?? "Opção",
    };
  });
  const subtotal = itens.reduce((s, i) => s + i.total, 0);
  const frete = entrega.valor ?? 0;
  return {
    ok: true,
    pedido: {
      numero: 1001,
      subtotal,
      frete,
      frete_a_combinar: entrega.valor === null,
      total: subtotal + frete,
      entrega: entrega.nome,
      endereco: dados.endereco ?? null,
      pagamento: { pix: "PIX", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito", dinheiro: "Dinheiro" }[dados.pagamento],
      troco_para: dados.troco_para ?? null,
      whatsapp: d.loja.whatsapp ?? "",
      nome: dados.nome,
      itens,
    },
  };
}
