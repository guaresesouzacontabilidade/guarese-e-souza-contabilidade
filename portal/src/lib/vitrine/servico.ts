import "server-only";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { hashChave } from "./chave";
import { urlFotoBase } from "./fotos";

/**
 * Chamadas da vitrine (o site da loja) ao banco. Só o servidor do portal faz
 * essas chamadas, depois de conferir a chave; o banco confere a chave de novo
 * e devolve só o que pode aparecer no site (sem custo, sem estoque exato).
 */

type ComFotos = { fotos?: string[] | null };
const comUrls = <T extends ComFotos>(p: T): T => ({ ...p, fotos: (p.fotos ?? []).map(urlFotoBase) });

export async function lerVitrine(slug: string, chave: string) {
  const { data, error } = await criarClienteAdmin().rpc("loja_site_vitrine", { p_slug: slug, p_chave_hash: hashChave(chave) });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const v = data as { aberta: boolean; loja: Json; categorias?: Json[]; produtos?: ComFotos[]; banners?: { computador: string; celular: string }[] };
  return {
    ...v,
    categorias: v.categorias ?? [],
    produtos: (v.produtos ?? []).map(comUrls),
    banners: (v.banners ?? []).map((b) => ({ ...b, computador: urlFotoBase(b.computador), celular: urlFotoBase(b.celular) })),
  };
}

export async function lerProdutoVitrine(slug: string, chave: string, produtoId: string) {
  const { data, error } = await criarClienteAdmin().rpc("loja_site_vitrine_produto", {
    p_slug: slug,
    p_chave_hash: hashChave(chave),
    p_produto_id: produtoId,
  });
  if (error) throw new Error(error.message);
  return data ? comUrls(data as ComFotos) : null;
}

export type ResultadoPedidoSite =
  | { ok: true; pedido: Json }
  | { ok: false; mensagem: string; precosMudaram?: boolean; naoEncontrada?: boolean };

export async function registrarPedidoSite(slug: string, chave: string, dados: Record<string, unknown>): Promise<ResultadoPedidoSite> {
  const { data, error } = await criarClienteAdmin().rpc("loja_site_pedido", {
    p_slug: slug,
    p_chave_hash: hashChave(chave),
    p_dados: dados as Json,
  });
  if (!error) return { ok: true, pedido: data as Json };
  if (error.code === "42501") return { ok: false, mensagem: "Loja não encontrada.", naoEncontrada: true };
  if (error.code === "P0002") return { ok: false, mensagem: error.message, precosMudaram: true };
  if (error.code === "P0001") return { ok: false, mensagem: error.message };
  return { ok: false, mensagem: "Confira os dados do pedido e tente de novo." };
}
