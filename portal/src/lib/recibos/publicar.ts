import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mensagemErro } from "@/lib/acoes";
import { competenciaDe } from "@/lib/competencia";
import { publicarPdfNosDocumentos } from "@/lib/guias/publicar-pdf";
import type { Database } from "@/lib/supabase/database.types";
import { arquivoAssinado, gerarArquivoRecibo } from "./arquivo";
import { carregarRecibo } from "./carregar";
import { numeroRecibo } from "./comum";
import { nomeArquivoRecibo } from "./pdf";

/**
 * Publica o PDF do recibo em "Recibos", nos documentos da empresa: o arquivo
 * assinado, quando existe (ou o que acabou de ser gerado).
 */
export async function publicarReciboNosDocumentos(supabase: SupabaseClient<Database>, reciboId: string, pronto?: Buffer): Promise<{ erro: string } | { ok: true }> {
  const r = await carregarRecibo(supabase, reciboId);
  if (!r) return { erro: "Recibo não encontrado." };
  if (!r.linha.empresa_id) return { erro: "Este recibo é de um pagador avulso (sem empresa no portal)." };
  if (r.linha.situacao !== "emitido") return { erro: "Este recibo foi cancelado." };
  const pdf = pronto ?? (await arquivoAssinado(r.linha)) ?? (await gerarArquivoRecibo(supabase, r.linha)).pdf;
  const competencia = r.linha.competencia ?? competenciaDe(r.linha.data_recibo);
  const pub = await publicarPdfNosDocumentos(supabase, {
    empresaId: r.linha.empresa_id,
    competencia,
    categoria: "esc_recibo",
    nomeArquivo: nomeArquivoRecibo(r.pdf),
    titulo: `Recibo nº ${numeroRecibo(r.linha)} — ${r.linha.referencia}`,
    valor: String(r.linha.valor),
    pdf,
    rotulo: { nome: "o recibo", publicado: "publicado" },
  });
  if ("erro" in pub) return pub;
  const { error } = await supabase.rpc("recibo_vincular_documento", { p_recibo_id: reciboId, p_documento_id: pub.documentoId });
  if (error) return { erro: mensagemErro(error) };
  return { ok: true };
}

