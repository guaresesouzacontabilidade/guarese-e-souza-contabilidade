import "server-only";
import type { ClienteSupabase } from "@/lib/supabase/server";
import { dec, type ValorEntrada } from "@/lib/dinheiro";
import { buscarTudo } from "@/lib/supabase/paginar";
import { competenciaDe, somarDias, ultimoDiaDoMes } from "@/lib/competencia";
import {
  mesesEntre,
  montarAging,
  montarDre,
  montarFluxoMensal,
  saldoDisponivel,
  type LinhaDreBanco,
  type LinhaFluxoRealizado,
  type SaldoContaLinha,
} from "./calculos";

/**
 * Consultas dos relatórios de uma empresa. Usam as funções do banco
 * (security invoker): as políticas RLS do usuário continuam valendo.
 * Compartilhadas pela página de relatórios e pela exportação.
 */

export const RELATORIOS = {
  fluxo: "Fluxo de caixa",
  dre: "Resultado (DRE)",
  contas: "Contas a pagar e a receber",
  saldos: "Saldos por conta",
} as const;

export type TipoRelatorio = keyof typeof RELATORIOS;

export function lerTipoRelatorio(v: unknown): TipoRelatorio {
  return typeof v === "string" && v in RELATORIOS ? (v as TipoRelatorio) : "fluxo";
}

export async function carregarFluxo(sb: ClienteSupabase, empresaId: string, inicio: string, fim: string) {
  const ate = ultimoDiaDoMes(fim);
  const [realizados, previstos] = await Promise.all([
    buscarTudo((de, a) =>
      sb
        .rpc("relatorio_fluxo_realizado", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: ate })
        .order("data")
        .order("registro_id")
        .order("conta_id")
        .range(de, a),
    ),
    buscarTudo((de, a) =>
      sb
        .from("lancamentos")
        .select("tipo, data_vencimento, valor_previsto")
        .eq("empresa_id", empresaId)
        .eq("status_revisao", "confirmado")
        .neq("situacao", "cancelado")
        .gte("data_vencimento", inicio)
        .lte("data_vencimento", ate)
        .order("id")
        .range(de, a),
    ),
  ]);
  return montarFluxoMensal(mesesEntre(inicio, fim), realizados as LinhaFluxoRealizado[], previstos);
}

export async function carregarDre(sb: ClienteSupabase, empresaId: string, inicio: string, fim: string) {
  const linhas = await buscarTudo((de, a) =>
    sb
      .rpc("relatorio_dre_linhas", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: ultimoDiaDoMes(fim) })
      .order("mes")
      .order("categoria_id")
      .order("origem")
      .range(de, a),
  );
  const meses = mesesEntre(inicio, fim);
  return { meses, ...montarDre(meses, linhas as LinhaDreBanco[]) };
}

/** Contas em aberto na data de hoje (lançamentos confirmados, fora cartões). */
export async function carregarAging(sb: ClienteSupabase, empresaId: string, hoje: string) {
  const [abertos, sugeridos] = await Promise.all([
    buscarTudo((de, a) =>
      sb
        .from("lancamentos")
        .select("id, tipo, data_vencimento, valor_previsto, valor_baixado, contraparte:contrapartes(nome), conta:contas_financeiras(tipo)")
        .eq("empresa_id", empresaId)
        .eq("status_revisao", "confirmado")
        .in("situacao", ["aberto", "parcial"])
        .order("data_vencimento")
        .order("id")
        .range(de, a),
    ),
    sb.from("lancamentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("status_revisao", "sugerido").neq("situacao", "cancelado"),
  ]);
  // Compras no cartão são pagas pela fatura (mesmo critério do painel financeiro)
  const lista = abertos
    .filter((l) => (l.conta as { tipo: string } | null)?.tipo !== "cartao_credito")
    .map((l) => ({ ...l, contraparte: (l.contraparte as { nome: string } | null)?.nome ?? null }));
  return { ...montarAging(lista, hoje), sugeridos: sugeridos.count ?? 0 };
}

/**
 * Saldos por conta no início e no fim do período e saldo disponível ao fim
 * de cada mês (datas futuras são limitadas a hoje).
 */
const talvez = (v: ValorEntrada) => (v === null || v === undefined ? null : dec(v));

export async function carregarSaldos(sb: ClienteSupabase, empresaId: string, inicio: string, fim: string, hoje: string) {
  const dataFinal = ultimoDiaDoMes(fim) > hoje ? hoje : ultimoDiaDoMes(fim);
  const dataInicial = somarDias(inicio, -1);
  const fechamentos = mesesEntre(inicio, fim)
    .map((m) => ({ mes: m, data: ultimoDiaDoMes(m) > hoje ? hoje : ultimoDiaDoMes(m) }))
    .filter((f) => f.mes <= competenciaDe(hoje));
  const consultar = async (data: string) => {
    const { data: linhas, error } = await sb.rpc("saldos_contas", { p_empresa_id: empresaId, p_data: data });
    if (error) throw new Error(error.message);
    return (linhas ?? []) as SaldoContaLinha[];
  };
  const [inicial, final, ...mensais] = await Promise.all([consultar(dataInicial), consultar(dataFinal), ...fechamentos.map((f) => consultar(f.data))]);
  const anterior = new Map(inicial.map((s) => [s.conta_id, s.saldo_sistema]));
  return {
    dataInicial,
    dataFinal,
    contas: final.map((s) => ({
      ...s,
      saldo_sistema: talvez(s.saldo_sistema),
      saldo_extrato: talvez(s.saldo_extrato),
      saldo_inicial_periodo: talvez(anterior.get(s.conta_id)),
    })),
    disponivelInicial: saldoDisponivel(inicial),
    disponivelFinal: saldoDisponivel(final),
    evolucao: fechamentos.map((f, i) => ({ mes: f.mes, data: f.data, ...saldoDisponivel(mensais[i]) })),
  };
}

export type DadosSaldos = Awaited<ReturnType<typeof carregarSaldos>>;
