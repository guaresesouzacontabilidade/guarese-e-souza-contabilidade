import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { DespesaFrota, VeiculoFrota, ViagemFrota } from "./rentabilidade";

type Cliente = SupabaseClient<Database>;

export const CAMPOS_VEICULO =
  "id, placa, descricao, tipo, km_inicial, custo_motorista_mensal, depreciacao_mensal, financiamento_mensal, seguro_mensal, outros_fixos_mensal, ativo";
const CAMPOS_VIAGEM =
  "id, veiculo_id, data, cte_numero, remetente, origem, destinatario, destino, mercadoria, motorista, peso_kg, valor_frete, icms, comissao_motorista, quebra, outras_deducoes";
const CAMPOS_DESPESA = "id, veiculo_id, data, grupo, fornecedor, documento, descricao, litros, km, valor";

export function limitesDoMes(mes: string) {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fim };
}

/** Mês com o último frete lançado (para abrir o relatório já com dados). */
export async function mesMaisRecente(supabase: Cliente, empresaId: string, hoje: string) {
  const { data } = await supabase.from("frota_viagens").select("data").eq("empresa_id", empresaId).lte("data", hoje).order("data", { ascending: false }).limit(1).maybeSingle();
  return (data?.data ?? hoje).slice(0, 7);
}

export async function carregarFrota(supabase: Cliente, empresaId: string, mes: string) {
  const { inicio, fim } = limitesDoMes(mes);
  const [{ data: veiculos }, { data: viagens }, { data: despesas }] = await Promise.all([
    supabase.from("frota_veiculos").select(CAMPOS_VEICULO).eq("empresa_id", empresaId).order("placa"),
    supabase.from("frota_viagens").select(CAMPOS_VIAGEM).eq("empresa_id", empresaId).gte("data", inicio).lte("data", fim).order("data").limit(5000),
    supabase.from("frota_despesas").select(CAMPOS_DESPESA).eq("empresa_id", empresaId).gte("data", inicio).lte("data", fim).order("data").limit(10000),
  ]);
  const lista = (veiculos ?? []) as (VeiculoFrota & { ativo: boolean })[];
  const comMovimento = new Set([...(viagens ?? []).map((v) => v.veiculo_id), ...(despesas ?? []).map((d) => d.veiculo_id)]);
  const doRelatorio = lista.filter((v) => v.ativo || comMovimento.has(v.id));
  // Última leitura do hodômetro antes do mês (início do km rodado)
  const antes = await Promise.all(
    doRelatorio.map(async (v) => {
      const { data } = await supabase
        .from("frota_despesas")
        .select("km")
        .eq("veiculo_id", v.id)
        .lt("data", inicio)
        .not("km", "is", null)
        .order("data", { ascending: false })
        .order("km", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [v.id, data?.km === null || data?.km === undefined ? null : Number(data.km)] as const;
    }),
  );
  return {
    todos: lista,
    veiculos: doRelatorio,
    viagens: (viagens ?? []) as ViagemFrota[],
    despesas: (despesas ?? []) as DespesaFrota[],
    kmAntes: Object.fromEntries(antes) as Record<string, number | null>,
  };
}
