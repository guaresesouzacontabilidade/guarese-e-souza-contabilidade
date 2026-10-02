"use server";

import { criarClienteServidor } from "@/lib/supabase/server";
import { dadosRequisicao } from "@/lib/requisicao";

/** Registra o login (após a verificação em duas etapas) e eventos de 2FA. */
export async function registrarAcessoMfa(evento?: "mfa_ativado" | "mfa_removido") {
  const supabase = await criarClienteServidor();
  const { ip, userAgent } = await dadosRequisicao();
  if (evento) {
    const { data } = await supabase.auth.getClaims();
    await supabase.rpc("registrar_evento", {
      p_acao: evento,
      p_entidade: "perfis",
      p_entidade_id: data?.claims?.sub,
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
    });
    if (evento === "mfa_removido") return;
  }
  await supabase.rpc("registrar_login", { p_ip: ip ?? undefined, p_user_agent: userAgent ?? undefined });
}
