import "server-only";
import { criarClienteAdmin } from "@/lib/supabase/admin";

/**
 * Cobrança pelo link de pagamento (código aleatório de 32 letras, enviado só
 * ao contato do cliente). Lida no servidor; o navegador não recebe chave.
 */
export async function cobrancaPorToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const admin = criarClienteAdmin();
  const { data: c } = await admin.from("honorarios_cobrancas").select("*").eq("token_publico", token).in("situacao", ["aberta", "paga"]).maybeSingle();
  if (!c) return null;
  const { data: itens } = await admin.from("honorarios_cobranca_itens").select("*").eq("cobranca_id", c.id).order("ordem");
  return { c, itens: itens ?? [] };
}
