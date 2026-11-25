import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ClientePdv, OrcamentoInicial, ProdutoPdv } from "@/components/loja/ponto-de-venda";
import type { ConfigEtiqueta } from "@/lib/gestao/balanca";

type Cliente = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface DadosPdv {
  produtos: ProdutoPdv[];
  clientes: ClientePdv[];
  permitirPrazo: boolean;
  etiqueta: ConfigEtiqueta | null;
  /** Orçamento em aberto pedido no endereço (para vender ou editar). */
  orcamento: OrcamentoInicial | null;
  /** O endereço pediu um orçamento que não está mais em aberto. */
  orcamentoFechado: boolean;
}

/** Produtos, clientes e configuração da loja para a tela de vender e a de orçamento. */
export async function carregarPdv(supabase: Cliente, empresaId: string, orcamentoPedido: unknown): Promise<DadosPdv> {
  const orcamentoId = typeof orcamentoPedido === "string" && UUID.test(orcamentoPedido) ? orcamentoPedido : null;
  const [produtosR, clientesR, cfgR, orcR] = await Promise.all([
    supabase
      .from("nfe_produtos")
      .select("id, codigo, descricao, unidade, gtin, grupo, valor_unitario, estoque_atual, controla_estoque, espessura_cm, largura_cm, comprimento_m, tara_kg")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("descricao")
      .limit(5000),
    supabase
      .from("contrapartes")
      .select("id, nome, documento, telefone")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .contains("papeis", ["cliente"])
      .order("nome")
      .limit(5000),
    supabase.from("gestao_config").select("permitir_venda_prazo, balanca_etiqueta, balanca_digitos_codigo").eq("empresa_id", empresaId).maybeSingle(),
    orcamentoId
      ? supabase
          .from("vendas")
          .select(
            "id, numero, status, cliente_id, cliente_nome, cliente_documento, cliente_telefone, desconto, frete, observacao, entrega, venda_itens(ordem, produto_id, pecas, comprimento_m, quantidade, preco_unitario, desconto)",
          )
          .eq("id", orcamentoId)
          .eq("empresa_id", empresaId)
          .eq("tipo", "orcamento")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const produtos: ProdutoPdv[] = (produtosR.data ?? []).map((p) => ({
    id: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    unidade: p.unidade,
    gtin: p.gtin,
    grupo: p.grupo,
    valor_unitario: texto(p.valor_unitario),
    estoque_atual: String(p.estoque_atual ?? 0),
    controla_estoque: p.controla_estoque,
    espessura_cm: texto(p.espessura_cm),
    largura_cm: texto(p.largura_cm),
    comprimento_m: texto(p.comprimento_m),
    tara_kg: texto(p.tara_kg),
  }));
  const clientes: ClientePdv[] = (clientesR.data ?? []).map((c) => ({ id: c.id, nome: c.nome, documento: c.documento, telefone: c.telefone }));

  const o = orcR.data;
  const orcamento: OrcamentoInicial | null =
    o && o.status === "aberto"
      ? {
          id: o.id,
          numero: Number(o.numero),
          cliente: clientes.find((c) => c.id === o.cliente_id) ?? null,
          clienteNome: o.cliente_id ? null : o.cliente_nome,
          clienteDocumento: o.cliente_id ? null : o.cliente_documento,
          clienteTelefone: o.cliente_id ? null : o.cliente_telefone,
          itens: [...(o.venda_itens ?? [])]
            .sort((a, b) => a.ordem - b.ordem)
            .map((i) => ({
              produto_id: i.produto_id,
              pecas: texto(i.pecas),
              comprimento_m: texto(i.comprimento_m),
              quantidade: String(i.quantidade),
              preco_unitario: String(i.preco_unitario),
              desconto: String(i.desconto),
            })),
          desconto: String(o.desconto),
          frete: String(o.frete),
          observacao: o.observacao,
          entrega: o.entrega,
        }
      : null;

  const cfg = cfgR.data;
  return {
    produtos,
    clientes,
    permitirPrazo: cfg?.permitir_venda_prazo ?? true,
    etiqueta:
      cfg?.balanca_etiqueta === "preco" || cfg?.balanca_etiqueta === "peso"
        ? { formato: cfg.balanca_etiqueta, digitosCodigo: ([4, 5, 6].includes(cfg.balanca_digitos_codigo) ? cfg.balanca_digitos_codigo : 4) as 4 | 5 | 6 }
        : null,
    orcamento,
    orcamentoFechado: Boolean(orcamentoId && !orcamento),
  };
}
