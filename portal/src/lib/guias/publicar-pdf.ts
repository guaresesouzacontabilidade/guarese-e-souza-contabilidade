import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mensagemErro } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Publica o PDF de uma guia emitida por robô nos documentos da empresa
 * (categoria "Guias de impostos"), pelo mesmo caminho do envio de documentos:
 * o banco confere a permissão e o formato; o arquivo vai para o armazenamento
 * privado. A guia aparece na agenda de pagamentos do cliente, com o "paguei".
 */
export async function publicarGuiaPdf(
  supabase: SupabaseClient<Database>,
  g: { empresaId: string; competencia: string; nomeArquivo: string; titulo: string; vencimento: string; valor: string; pdf: Buffer },
): Promise<{ documentoId: string } | { erro: string }> {
  const sha256 = createHash("sha256").update(g.pdf).digest("hex");
  const { data: criado, error } = await supabase.rpc("criar_documento", {
    p_empresa_id: g.empresaId,
    p_competencia: g.competencia,
    p_categoria: "esc_guia",
    p_nome_arquivo: g.nomeArquivo,
    p_mime: "application/pdf",
    p_tamanho: g.pdf.length,
    p_sha256: sha256,
    p_titulo: g.titulo,
    p_vencimento: g.vencimento,
    p_valor: g.valor as unknown as number,
  });
  const r = criado as unknown as { situacao: string; versao_id?: string; storage_path?: string; duplicado?: { id: string } } | null;
  if (error || !r) return { erro: `a guia não entrou nos documentos: ${mensagemErro(error)}` };
  if (r.situacao === "duplicado" && r.duplicado?.id) return { documentoId: r.duplicado.id };
  const admin = criarClienteAdmin();
  const { error: erroUp } = await admin.storage.from("documentos").upload(r.storage_path!, g.pdf, { contentType: "application/pdf", upsert: false });
  if (erroUp) return { erro: "o PDF não foi guardado" };
  const { data: conf, error: erroConf } = await supabase.rpc("confirmar_upload", { p_versao_id: r.versao_id! });
  if (erroConf) return { erro: `a guia não foi publicada: ${mensagemErro(erroConf)}` };
  processarFilaDepois({ tipos: ["processar_documento", "enviar_envio"] });
  return { documentoId: (conf as unknown as { documento_id: string }).documento_id };
}
