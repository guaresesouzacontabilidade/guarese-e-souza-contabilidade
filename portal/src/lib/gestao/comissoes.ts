import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { dec, somar } from "@/lib/dinheiro";
import { buscarTudo } from "@/lib/supabase/paginar";

const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface FiltroComissoes {
  inicio: string;
  fim: string;
  vendedor: string;
}

export interface LinhaComissao {
  vendaId: string;
  numero: number;
  data: string;
  cliente: string | null;
  vendedorId: string;
  vendedor: string;
  base: number;
  percentual: number;
  valor: number;
  lancada: boolean;
}

export interface ResumoVendedor {
  vendedorId: string;
  vendedor: string;
  vendas: number;
  vendido: number;
  comissao: number;
  lancado: number;
  aLancar: number;
}

/** Período padrão: do dia 1º do mês até hoje. */
export function lerFiltroComissoes(sp: Record<string, string | string[] | undefined>, hoje: string): FiltroComissoes {
  const p = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const inicio = DATA.test(p("inicio")) ? p("inicio") : `${hoje.slice(0, 8)}01`;
  const fim = DATA.test(p("fim")) && p("fim") >= inicio ? p("fim") : hoje < inicio ? inicio : hoje;
  return { inicio, fim, vendedor: UUID.test(p("vendedor")) ? p("vendedor") : "" };
}

/**
 * Comissões das vendas concluídas no período (as canceladas ficam de fora).
 * O banco só entrega as do próprio vendedor para quem não gerencia a loja.
 */
export async function carregarComissoes(supabase: SupabaseClient<Database>, empresaId: string, f: FiltroComissoes) {
  const linhasBrutas = await buscarTudo((de, ate) => {
    let q = supabase
      .from("venda_comissoes")
      .select("venda_id, loja_vendedor_id, percentual, base, valor, lancamento_id, vendedor:loja_vendedores(nome), venda:vendas!inner(numero, data, status, cliente_nome)")
      .eq("empresa_id", empresaId)
      .eq("venda.status", "concluida")
      .gte("venda.data", f.inicio)
      .lte("venda.data", f.fim);
    if (f.vendedor) q = q.eq("loja_vendedor_id", f.vendedor);
    return q.order("venda_id").range(de, ate);
  }, 20000);

  const linhas: LinhaComissao[] = linhasBrutas
    .map((l) => {
      const v = l.venda as unknown as { numero: number; data: string; cliente_nome: string | null };
      return {
        vendaId: l.venda_id,
        numero: Number(v.numero),
        data: v.data,
        cliente: v.cliente_nome,
        vendedorId: l.loja_vendedor_id,
        vendedor: (l.vendedor as { nome: string } | null)?.nome ?? "—",
        base: dec(l.base).toNumber(),
        percentual: dec(l.percentual).toNumber(),
        valor: dec(l.valor ?? 0).toNumber(),
        lancada: Boolean(l.lancamento_id),
      };
    })
    .sort((a, b) => (a.data === b.data ? b.numero - a.numero : a.data < b.data ? 1 : -1));

  const porVendedor = new Map<string, LinhaComissao[]>();
  for (const l of linhas) porVendedor.set(l.vendedorId, [...(porVendedor.get(l.vendedorId) ?? []), l]);
  const resumo: ResumoVendedor[] = [...porVendedor.entries()]
    .map(([vendedorId, ls]) => ({
      vendedorId,
      vendedor: ls[0].vendedor,
      vendas: ls.length,
      vendido: somar(ls.map((l) => l.base)).toNumber(),
      comissao: somar(ls.map((l) => l.valor)).toNumber(),
      lancado: somar(ls.filter((l) => l.lancada).map((l) => l.valor)).toNumber(),
      aLancar: somar(ls.filter((l) => !l.lancada).map((l) => l.valor)).toNumber(),
    }))
    .sort((a, b) => b.vendido - a.vendido);
  const totais = {
    vendas: linhas.length,
    vendido: somar(resumo.map((r) => r.vendido)).toNumber(),
    comissao: somar(resumo.map((r) => r.comissao)).toNumber(),
    aLancar: somar(resumo.map((r) => r.aLancar)).toNumber(),
  };
  return { linhas, resumo, totais };
}
