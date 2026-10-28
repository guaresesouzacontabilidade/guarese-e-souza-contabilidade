import "server-only";
import type { ContextoHotel } from "./contexto";
import { calcularIndicadores, type IndicadoresHotel } from "./calculo";

type Supa = ContextoHotel["supabase"];

export interface RelatorioHotel {
  indicadores: IndicadoresHotel;
  recebido: { forma: string; valor: number; quantidade: number }[];
  recebidoTotal: number;
  aReceber: number;
}

/** Indicadores do hotel no período [de, ate): ocupação, diária média, RevPAR, origem, categorias e recebimentos. */
export async function carregarRelatorio(supabase: Supa, empresaId: string, de: string, ate: string): Promise<RelatorioHotel> {
  const [{ count: quartos }, { data: reservas }, { data: itens }, { data: perdidas }, { data: pagamentos }] = await Promise.all([
    supabase.from("hotel_quartos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true),
    supabase
      .from("hotel_reservas")
      .select("id, status, entrada, saida, origem, categoria:hotel_categorias!hotel_reservas_empresa_id_categoria_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .in("status", ["hospedado", "encerrada"])
      .lt("entrada", ate)
      .gt("saida", de),
    supabase
      .from("hotel_conta_itens")
      .select("tipo, total, setor, reserva:hotel_reservas!hotel_conta_itens_empresa_id_reserva_id_fkey(categoria:hotel_categorias!hotel_reservas_empresa_id_categoria_id_fkey(nome))")
      .eq("empresa_id", empresaId)
      .is("cancelado_em", null)
      .gte("data", de)
      .lt("data", ate),
    supabase.from("hotel_reservas").select("status").eq("empresa_id", empresaId).in("status", ["cancelada", "no_show"]).gte("entrada", de).lt("entrada", ate),
    supabase.from("hotel_pagamentos").select("forma, valor").eq("empresa_id", empresaId).is("cancelado_em", null).gte("data", de).lt("data", ate),
  ]);
  const indicadores = calcularIndicadores({
    de,
    ate,
    quartos: quartos ?? 0,
    reservas: (reservas ?? []).map((r) => ({ status: r.status, entrada: r.entrada, saida: r.saida, origem: r.origem, categoria: r.categoria?.nome ?? "—" })),
    itens: (itens ?? []).map((i) => ({ tipo: i.tipo, total: Number(i.total), categoria: i.reserva?.categoria?.nome, setor: i.setor })),
    canceladas: (perdidas ?? []).filter((p) => p.status === "cancelada").length,
    noShow: (perdidas ?? []).filter((p) => p.status === "no_show").length,
  });
  const porForma = new Map<string, { valor: number; quantidade: number }>();
  for (const p of pagamentos ?? []) {
    const a = porForma.get(p.forma) ?? { valor: 0, quantidade: 0 };
    a.valor = Math.round((a.valor + Number(p.valor)) * 100) / 100;
    a.quantidade += 1;
    porForma.set(p.forma, a);
  }
  const recebido = [...porForma].map(([forma, v]) => ({ forma, ...v })).sort((a, b) => b.valor - a.valor);
  return {
    indicadores,
    recebido,
    recebidoTotal: Math.round(recebido.filter((r) => r.forma !== "faturado").reduce((s, r) => s + r.valor, 0) * 100) / 100,
    aReceber: recebido.find((r) => r.forma === "faturado")?.valor ?? 0,
  };
}

/** Primeiro dia do mês seguinte (AAAA-MM-01). */
export function proximoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

export function mesAnterior(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}
