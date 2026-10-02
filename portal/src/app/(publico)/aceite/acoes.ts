"use server";

import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { dadosRequisicao } from "@/lib/requisicao";
import { VERSAO_TERMOS } from "@/lib/termos";
import { falha, type ResultadoAcao } from "@/lib/acoes";

export async function aceitarTermos(_anterior: ResultadoAcao, formData: FormData): Promise<ResultadoAcao> {
  if (formData.get("concordo") !== "on") return falha("Para continuar, confirme que leu e concorda com os termos.");
  const supabase = await criarClienteServidor();
  const { ip, userAgent } = await dadosRequisicao();
  const { error } = await supabase.rpc("registrar_aceite_termos", {
    p_versao: VERSAO_TERMOS,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  if (error) return falha("Não foi possível registrar o aceite. Tente novamente.");
  redirect("/painel");
}
