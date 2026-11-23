import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mensagemErro } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Publica um PDF gerado pelo portal nos documentos da empresa, pelo mesmo
 * caminho do envio de documentos: o banco confere a permissão e o formato; o
 * arquivo vai para o armazenamento privado.
 */
export async function publicarPdfNosDocumentos(
  supabase: SupabaseClient<Database>,
  d: {
    empresaId: string;
    competencia: string;
    categoria: "esc_guia" | "esc_recibo" | "esc_contrato";
    nomeArquivo: string;
    titulo: string;
    vencimento?: string | null;
    valor?: string | null;
    pdf: Buffer;
    /** Como o documento aparece nas mensagens de erro (ex.: "a guia" / "publicada"). */
    rotulo: { nome: string; publicado: string };
  },
): Promise<{ documentoId: string } | { erro: string }> {
  const sha256 = createHash("sha256").update(d.pdf).digest("hex");
  const { data: criado, error } = await supabase.rpc("criar_documento", {
    p_empresa_id: d.empresaId,
    p_competencia: d.competencia,
    p_categoria: d.categoria,
    p_nome_arquivo: d.nomeArquivo,
    p_mime: "application/pdf",
    p_tamanho: d.pdf.length,
    p_sha256: sha256,
    p_titulo: d.titulo,
    p_vencimento: d.vencimento ?? undefined,
    p_valor: (d.valor ?? undefined) as unknown as number,
  });
  const r = criado as unknown as { situacao: string; versao_id?: string; storage_path?: string; duplicado?: { id: string } } | null;
  if (error || !r) return { erro: `${d.rotulo.nome} não entrou nos documentos: ${mensagemErro(error)}` };
  if (r.situacao === "duplicado" && r.duplicado?.id) return { documentoId: r.duplicado.id };
  const admin = criarClienteAdmin();
  const { error: erroUp } = await admin.storage.from("documentos").upload(r.storage_path!, d.pdf, { contentType: "application/pdf", upsert: false });
  if (erroUp) return { erro: "o PDF não foi guardado" };
  const { data: conf, error: erroConf } = await supabase.rpc("confirmar_upload", { p_versao_id: r.versao_id! });
  if (erroConf) return { erro: `${d.rotulo.nome} não foi ${d.rotulo.publicado}: ${mensagemErro(erroConf)}` };
  processarFilaDepois({ tipos: ["processar_documento", "enviar_envio"] });
  return { documentoId: (conf as unknown as { documento_id: string }).documento_id };
}

/**
 * Publica o PDF de uma guia emitida por robô (categoria "Guias de impostos").
 * A guia aparece na agenda de pagamentos do cliente, com o "paguei".
 */
export async function publicarGuiaPdf(
  supabase: SupabaseClient<Database>,
  g: { empresaId: string; competencia: string; nomeArquivo: string; titulo: string; vencimento: string; valor: string; pdf: Buffer },
): Promise<{ documentoId: string } | { erro: string }> {
  return publicarPdfNosDocumentos(supabase, { ...g, categoria: "esc_guia", rotulo: { nome: "a guia", publicado: "publicada" } });
}
