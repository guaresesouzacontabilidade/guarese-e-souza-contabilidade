import type { SupabaseClient } from "@supabase/supabase-js";
import { mensagemErro } from "@/lib/acoes";
import type { Database } from "@/lib/supabase/database.types";

/** Dados da tela do DAR do ICMS (EFD do mês, vencimento em dia útil, DAR já emitidos). */
export interface DadosDarIcms {
  empresa: { uf: string | null; inscricao_estadual: string | null; municipio_ibge: string | null; demonstracao: boolean; regime: string; contribuinte_icms: boolean };
  efd: { id: string; finalidade: number; a_recolher: string | null; vencimento: string | null; created_at: string } | null;
  vencimento_informado: string | null;
  vencimento_util: string | null;
  hoje: string;
  ultimo_dia_util: string;
  emissoes: {
    id: string;
    numero: string;
    principal: number;
    multa: number;
    juros: number;
    total: number;
    vencimento: string;
    linha_digitavel: string | null;
    documento_id: string | null;
    origem: string;
    gerado_por: string | null;
    created_at: string;
  }[];
}

export async function carregarDadosDar(
  supabase: SupabaseClient<Database>,
  empresaId: string,
  competencia: string,
  vencimento?: string | null,
): Promise<{ erro: string } | { dados: DadosDarIcms }> {
  const { data, error } = await supabase.rpc("dados_dar_icms", { p_empresa_id: empresaId, p_competencia: competencia, p_vencimento: vencimento ?? undefined });
  if (error || !data) return { erro: mensagemErro(error) ?? "Não foi possível carregar os dados do DAR." };
  return { dados: data as unknown as DadosDarIcms };
}
