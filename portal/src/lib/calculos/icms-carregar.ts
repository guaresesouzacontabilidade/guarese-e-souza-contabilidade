import "server-only";
import Decimal from "decimal.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { VERSAO_LEITURA } from "@/lib/fiscal/xml";
import { formatarData } from "@/lib/formatos";
import { calcularIcms, type DadosIcms, type ResultadoIcms } from "./icms";
import type { LinhaIcmsPrevisao } from "./previsao";

type Cliente = SupabaseClient<Database>;

/** Dados e cálculo da apuração do ICMS de uma empresa e competência (com a permissão de quem chama). */
export async function carregarIcms(
  supabase: Cliente,
  empresaId: string,
  competencia: string,
): Promise<{ dados: DadosIcms; resultado: ResultadoIcms } | { erro: string }> {
  const { data, error } = await supabase.rpc("dados_apuracao_icms", {
    p_empresa_id: empresaId,
    p_competencia: competencia,
    p_versao_leitura: VERSAO_LEITURA,
  });
  if (error || !data) return { erro: error?.message ?? "Não foi possível carregar a apuração do ICMS." };
  const dados = data as unknown as DadosIcms;
  return { dados, resultado: calcularIcms(dados) };
}

/**
 * Guias de ICMS para a previsão de impostos: as da conferência do escritório,
 * quando o mês foi conferido; senão, as calculadas agora.
 */
export function linhasIcmsPrevisao(dados: DadosIcms, resultado: ResultadoIcms): LinhaIcmsPrevisao[] {
  const guardado = dados.apuracao?.conferida_em ? dados.apuracao.resultado : null;
  if (guardado) {
    const quando = `Apuração do ICMS conferida pelo escritório em ${formatarData(dados.apuracao!.conferida_em!)}.`;
    return guardado.linhas
      .filter((l) => Number(l.valor) > 0)
      .map((l) => ({ chave: l.chave, titulo: l.titulo, guia: l.guia, valor: new Decimal(l.valor), detalhes: [quando], vencimento: l.vencimento }));
  }
  return resultado.linhas.map((l) => ({ chave: l.chave, titulo: l.titulo, guia: l.guia, valor: l.valor, detalhes: l.detalhes, vencimento: l.vencimento }));
}
