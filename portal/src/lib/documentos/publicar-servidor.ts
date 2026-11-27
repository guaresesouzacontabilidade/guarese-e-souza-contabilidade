import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mensagemErro } from "@/lib/acoes";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Publica à empresa um arquivo gerado no servidor (documento do escritório):
 * o banco confere a permissão de quem pediu, a categoria e o formato
 * (criar_documento); o servidor grava no armazenamento privado e confirma —
 * a partir daí o cliente vê em Documentos e recebe o aviso.
 */
export async function publicarArquivoDoEscritorio(
  supabase: SupabaseClient<Database>,
  empresaId: string,
  arquivo: { categoria: string; competencia: string; nome: string; mime: string; bytes: Buffer; titulo: string; vencimento?: string; valor?: string },
): Promise<{ documentoId: string } | { erro: string }> {
  const sha256 = createHash("sha256").update(arquivo.bytes).digest("hex");
  const { data, error } = await supabase.rpc("criar_documento", {
    p_empresa_id: empresaId,
    p_competencia: arquivo.competencia,
    p_categoria: arquivo.categoria,
    p_nome_arquivo: arquivo.nome,
    p_mime: arquivo.mime,
    p_tamanho: arquivo.bytes.length,
    p_sha256: sha256,
    p_titulo: arquivo.titulo.slice(0, 200),
    p_vencimento: arquivo.vencimento,
    p_valor: arquivo.valor as unknown as number | undefined,
  });
  const r = data as unknown as { situacao: string; versao_id?: string; storage_path?: string; duplicado?: { id: string } } | null;
  if (error || !r) return { erro: mensagemErro(error) ?? "Não foi possível registrar o arquivo." };
  if (r.situacao === "duplicado" && r.duplicado) return { documentoId: r.duplicado.id };
  const { error: erroUp } = await criarClienteAdmin().storage.from("documentos").upload(r.storage_path!, arquivo.bytes, { contentType: arquivo.mime, upsert: false });
  if (erroUp) return { erro: "Não foi possível guardar o arquivo. Tente novamente." };
  const { data: conf, error: erroConf } = await supabase.rpc("confirmar_upload", { p_versao_id: r.versao_id! });
  if (erroConf || !conf) return { erro: mensagemErro(erroConf) ?? "Não foi possível publicar o arquivo." };
  return { documentoId: (conf as unknown as { documento_id: string }).documento_id };
}
