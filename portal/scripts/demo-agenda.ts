/**
 * Agenda de pagamentos de DEMONSTRAÇÃO: as guias fictícias já vencidas ficam
 * como pagas (com o comprovante enviado, quando houver), para a agenda mostrar
 * guias pagas e a pagar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function semearAgenda(admin: SupabaseClient, ids: string[]): Promise<number> {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: guias } = await admin
    .from("documentos")
    .select("id, empresa_id, competencia, vencimento, valor")
    .in("empresa_id", ids)
    .eq("direcao", "escritorio")
    .eq("categoria_codigo", "esc_guia")
    .not("publicado_em", "is", null)
    .is("excluido_em", null)
    .lt("vencimento", hoje);
  let n = 0;
  for (const g of guias ?? []) {
    const { data: ja } = await admin.from("guia_pagamentos").select("guia_documento_id").eq("guia_documento_id", g.id).maybeSingle();
    if (ja) continue;
    const { data: comprovante } = await admin
      .from("documentos")
      .select("id")
      .eq("empresa_id", g.empresa_id)
      .eq("direcao", "cliente")
      .eq("categoria_codigo", "guia_imposto")
      .eq("competencia", g.competencia)
      .is("excluido_em", null)
      .limit(1)
      .maybeSingle();
    const pago = new Date(`${g.vencimento}T12:00:00Z`);
    pago.setUTCDate(pago.getUTCDate() - 2);
    const { error } = await admin.from("guia_pagamentos").insert({
      guia_documento_id: g.id,
      empresa_id: g.empresa_id,
      pago_em: pago.toISOString().slice(0, 10),
      valor_pago: g.valor,
      comprovante_documento_id: comprovante?.id ?? null,
      observacao: "Pagamento fictício de demonstração.",
    });
    if (!error) n++;
  }
  return n;
}
