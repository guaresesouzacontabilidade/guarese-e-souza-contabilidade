import "server-only";
import type { obterContextoLoja } from "@/lib/gestao/contexto";
import { buscarTudo } from "@/lib/supabase/paginar";
import { urlFotoBase } from "./fotos";

type Supa = Awaited<ReturnType<typeof obterContextoLoja>>["supabase"];

export interface EntregaSite {
  id: string;
  nome: string;
  valor: number | null;
  detalhe?: string;
  endereco?: boolean;
}

export async function carregarSite(supabase: Supa, empresaId: string) {
  const { data } = await supabase
    .from("loja_sites")
    .select("empresa_id, ativo, slug, nome, endereco_site, whatsapp, instagram, email, endereco_loja, cidade, horario, aviso, sobre, politica_trocas, entregas, pagamentos, pedido_minimo, chave_inicio, chave_gerada_em, updated_at")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return data ? { ...data, entregas: (data.entregas ?? []) as unknown as EntregaSite[] } : null;
}

export type SiteLoja = NonNullable<Awaited<ReturnType<typeof carregarSite>>>;

export interface CategoriaSite {
  id: string;
  pai_id: string | null;
  nome: string;
  slug: string;
  ordem: number;
  ativa: boolean;
}

export async function carregarCategoriasSite(supabase: Supa, empresaId: string): Promise<CategoriaSite[]> {
  const { data } = await supabase
    .from("loja_site_categorias")
    .select("id, pai_id, nome, slug, ordem, ativa")
    .eq("empresa_id", empresaId)
    .order("ordem")
    .order("nome")
    .limit(2000);
  return data ?? [];
}

/** "Maquiagens › Bases" para listas e escolhas. */
export function nomeCompletoCategoria(c: CategoriaSite, todas: CategoriaSite[]) {
  const pai = c.pai_id ? todas.find((x) => x.id === c.pai_id) : null;
  return pai ? `${pai.nome} › ${c.nome}` : c.nome;
}

export interface ProdutoSite {
  id: string;
  codigo: string;
  descricao: string;
  valor_unitario: number | null;
  controla_estoque: boolean;
  estoque_atual: number;
  ativo: boolean;
  site: {
    visivel: boolean;
    nome: string | null;
    descricao: string | null;
    categoria_id: string | null;
    rotulo_variacao: string;
    variacoes: string[];
    fotos: string[];
    destaque: boolean;
    preco_de: number | null;
    origem_externa: string | null;
  } | null;
}

/** Produtos ativos da loja com os dados do site (quando já cadastrados). */
export async function carregarProdutosSite(supabase: Supa, empresaId: string): Promise<ProdutoSite[]> {
  const [produtos, site] = await Promise.all([
    buscarTudo((de, ate) =>
      supabase
        .from("nfe_produtos")
        .select("id, codigo, descricao, valor_unitario, controla_estoque, estoque_atual, ativo")
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .order("descricao")
        .range(de, ate),
    ),
    buscarTudo((de, ate) =>
      supabase
        .from("loja_site_produtos")
        .select("produto_id, visivel, nome, descricao, categoria_id, rotulo_variacao, variacoes, fotos, destaque, preco_de, origem_externa")
        .eq("empresa_id", empresaId)
        .range(de, ate),
    ),
  ]);
  const porProduto = new Map(site.map((s) => [s.produto_id, s]));
  return produtos.map((p) => {
    const s = porProduto.get(p.id);
    return {
      id: p.id,
      codigo: p.codigo,
      descricao: p.descricao,
      valor_unitario: p.valor_unitario === null ? null : Number(p.valor_unitario),
      controla_estoque: p.controla_estoque,
      estoque_atual: Number(p.estoque_atual ?? 0),
      ativo: p.ativo,
      site: s
        ? {
            visivel: s.visivel,
            nome: s.nome,
            descricao: s.descricao,
            categoria_id: s.categoria_id,
            rotulo_variacao: s.rotulo_variacao,
            variacoes: s.variacoes ?? [],
            fotos: s.fotos ?? [],
            destaque: s.destaque,
            preco_de: s.preco_de === null ? null : Number(s.preco_de),
            origem_externa: s.origem_externa,
          }
        : null,
    };
  });
}

/** Miniatura (600 px) de uma foto do site. */
export const miniatura = (caminho: string) => `${urlFotoBase(caminho)}-p.webp`;
