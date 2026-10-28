import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { carregarIcms } from "@/lib/calculos/icms-carregar";
import type { DadosIcms, ResultadoIcms } from "@/lib/calculos/icms";
import type { DadosEfd } from "./gerar";

type Cliente = SupabaseClient<Database>;

export interface DadosGeracaoEfd {
  dados: DadosEfd;
  icms: { dados: DadosIcms; resultado: ResultadoIcms };
  /** Vencimento do ICMS do mês (obrigações ou regra do estado), para sugerir no E116. */
  vencimentoSugerido: string | null;
}

/** Dados do mês para o gerador da EFD (com a permissão de quem chama: equipe com "calculos.gerenciar"). */
export async function carregarEfd(supabase: Cliente, empresaId: string, competencia: string): Promise<DadosGeracaoEfd | { erro: string }> {
  const [{ data, error }, icms] = await Promise.all([
    supabase.rpc("dados_efd_icms_ipi", { p_empresa_id: empresaId, p_competencia: competencia }),
    carregarIcms(supabase, empresaId, competencia),
  ]);
  if (error || !data) return { erro: error?.message ?? "Não foi possível carregar os dados da EFD." };
  if ("erro" in icms) return { erro: icms.erro };
  const vencimentoSugerido =
    icms.resultado.linhas.find((l) => l.chave === "icms_proprio")?.vencimento ?? icms.dados.vencimentos.find((v) => v.codigo === "ICMS")?.vencimento ?? null;
  return { dados: data as unknown as DadosEfd, icms, vencimentoSugerido };
}
