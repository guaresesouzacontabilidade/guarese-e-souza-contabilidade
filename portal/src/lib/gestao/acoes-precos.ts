"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Preços de venda e margens da loja. Só quem gerencia a loja; o banco
 * confere de novo (permissão, gestão ligada e empresa).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidarLoja(empresaId: string) {
  revalidatePath(`/e/${empresaId}/loja`, "layout");
}

/** "35", "35,5" ou "" (sem margem). Retorna undefined quando inválido. */
function lerMargem(texto: string | null | undefined): number | null | undefined {
  const t = (texto ?? "").replace("%", "").trim();
  if (!t) return null;
  const d = lerValorBR(t);
  if (!d || d.lt(0) || d.gt(1000)) return undefined;
  return Number(d.toDecimalPlaces(2).toString());
}

export interface PrecoParaSalvar {
  produto_id: string;
  /** Preço novo no formato brasileiro ("1.234,56"); ausente = não muda. */
  preco?: string;
  /** Meta de margem (%); ausente = não muda; "" = tira a do produto. */
  margem?: string;
}

export async function salvarPrecos(empresaId: string, itens: PrecoParaSalvar[]): Promise<ResultadoAcao<{ alterados: number }>> {
  try {
    if (!UUID.test(empresaId)) return falha("Empresa inválida.");
    const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
    if (!itens.length) return falha("Nenhuma alteração para salvar.");
    const lote: Record<string, unknown>[] = [];
    for (const it of itens) {
      if (!UUID.test(it.produto_id)) return falha("Produto inválido.");
      const linha: Record<string, unknown> = { produto_id: it.produto_id };
      if (it.preco !== undefined) {
        const d = lerValorBR(it.preco);
        if (!d || d.lt(0)) return falha(`Preço inválido: "${it.preco}". Use o formato 1.234,56.`);
        linha.preco = d.toDecimalPlaces(4).toString();
      }
      if (it.margem !== undefined) {
        const m = lerMargem(it.margem);
        if (m === undefined) return falha(`Margem inválida: "${it.margem}". Use um número entre 0 e 1000.`);
        linha.margem = m;
      }
      lote.push(linha);
    }
    const { data, error } = await ctx.supabase.rpc("gestao_precos_salvar", { p_empresa_id: empresaId, p_itens: lote as Json });
    if (error) return falha(mensagemErro(error));
    revalidarLoja(empresaId);
    const n = Number(data ?? 0);
    return sucesso(n ? `${n} preço(s) atualizado(s).` : "Alterações salvas.", { alterados: n });
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function definirMargemPadrao(empresaId: string, margem: string): Promise<ResultadoAcao> {
  try {
    const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
    const m = lerMargem(margem);
    if (m === undefined) return falha("Margem inválida. Use um número entre 0 e 1000.");
    const { error } = await ctx.supabase.rpc("gestao_margem_padrao", { p_empresa_id: empresaId, p_margem: m as number });
    if (error) return falha(mensagemErro(error));
    revalidarLoja(empresaId);
    return sucesso(m === null ? "Margem padrão removida." : "Margem padrão salva.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function definirMargemGrupo(empresaId: string, grupo: string, margem: string): Promise<ResultadoAcao> {
  try {
    const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
    const m = lerMargem(margem);
    if (m === undefined) return falha("Margem inválida. Use um número entre 0 e 1000.");
    const { error } = await ctx.supabase.rpc("gestao_grupo_margem", { p_empresa_id: empresaId, p_grupo: grupo, p_margem: m as number });
    if (error) return falha(mensagemErro(error));
    revalidarLoja(empresaId);
    return sucesso(m === null ? `Margem do grupo ${grupo} removida.` : `Margem do grupo ${grupo} salva.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Margem do produto (usada no cadastro, depois de salvar o produto). */
export async function definirMargemProduto(empresaId: string, produtoId: string, margem: string): Promise<ResultadoAcao> {
  try {
    const ctx = await exigirPermissao(empresaId, "gestao.gerenciar");
    const m = lerMargem(margem);
    if (m === undefined) return falha("Margem inválida. Use um número entre 0 e 1000.");
    const { error } = await ctx.supabase.rpc("gestao_produto_margem", { p_empresa_id: empresaId, p_produto_id: produtoId, p_margem: m as number });
    if (error) return falha(mensagemErro(error));
    return sucesso();
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
