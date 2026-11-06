import "server-only";
import { cache } from "react";
import { obterSessao } from "@/lib/auth/sessao";

/**
 * Site da loja liberado pelo escritório para a empresa. Sem liberação, a aba
 * "Site da loja" não aparece e o banco recusa as funções do site. Em caso de
 * erro na consulta, responde "não liberado".
 */
export const siteLiberado = cache(async (empresaId: string): Promise<boolean> => {
  const s = await obterSessao();
  if (!s?.perfil) return false;
  const { data, error } = await s.supabase.from("loja_site_liberacoes").select("empresa_id").eq("empresa_id", empresaId).maybeSingle();
  return !error && Boolean(data);
});
