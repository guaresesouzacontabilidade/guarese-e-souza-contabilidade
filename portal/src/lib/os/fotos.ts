"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { assinaturaConfere } from "@/lib/hotel/comprovante-arquivo";

/**
 * Fotos da OS (material recebido, durante, serviço pronto, retirada): o banco
 * registra (permissão, formato, tamanho, limite de 20 por OS) e o servidor
 * devolve uma URL temporária para a foto ir direto do navegador ao
 * armazenamento privado; depois o tipo real do arquivo é conferido.
 */

const BUCKET = "os-fotos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const LIMITE = 10 * 1024 * 1024;

async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  if (ctx.acesso.ferramentas_desligadas.includes("os") || !ctx.pode("os.operar")) return null;
  return ctx;
}

export async function iniciarFotoOs(
  empresaId: string,
  osId: string,
  dados: { mime: string; tamanho: number; momento: string; legenda?: string },
): Promise<ResultadoAcao<{ fotoId: string; url: string }>> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso às ordens de serviço desta empresa.");
  if (!UUID.test(osId)) return falha("OS inválida.");
  if (!MIMES.has(dados.mime)) return falha("Envie uma foto (JPG, PNG, WEBP ou HEIC).");
  if (!Number.isInteger(dados.tamanho) || dados.tamanho <= 0 || dados.tamanho > LIMITE) return falha("A foto pode ter até 10 MB.");
  const { data, error } = await ctx.supabase.rpc("os_foto_iniciar", {
    p_ordem_id: osId,
    p_dados: { mime: dados.mime, tamanho: dados.tamanho, momento: String(dados.momento ?? "outro").slice(0, 20), legenda: String(dados.legenda ?? "").slice(0, 200) },
  });
  if (error) return falha(mensagemErro(error));
  const r = data as { foto_id: string; caminho: string };
  if (!r?.caminho?.startsWith(`${empresaId}/${osId}/`)) return falha("Não foi possível preparar o envio.");
  const { data: envio, error: e2 } = await criarClienteAdmin().storage.from(BUCKET).createSignedUploadUrl(r.caminho);
  if (e2 || !envio) return falha("Não foi possível preparar o envio da foto. Tente novamente.");
  return sucesso(undefined, { fotoId: r.foto_id, url: envio.signedUrl });
}

export async function concluirFotoOs(empresaId: string, fotoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso às ordens de serviço desta empresa.");
  if (!UUID.test(fotoId)) return falha("Foto inválida.");
  const { data: foto } = await ctx.supabase.from("os_fotos").select("empresa_id, caminho, mime, enviado_por, confirmado_em").eq("id", fotoId).maybeSingle();
  if (!foto || foto.empresa_id !== empresaId) return falha("Foto não encontrada.");
  if (foto.enviado_por !== ctx.sessao.usuarioId) return falha("Somente quem iniciou o envio pode confirmá-lo.");
  if (foto.confirmado_em) return sucesso("Foto anexada.");
  const admin = criarClienteAdmin();
  const { data: arquivo } = await admin.storage.from(BUCKET).download(foto.caminho);
  if (!arquivo) return falha("A foto não chegou ao armazenamento. Tente enviar novamente.");
  if (!assinaturaConfere(foto.mime, new Uint8Array(await arquivo.slice(0, 16).arrayBuffer()))) {
    await admin.storage.from(BUCKET).remove([foto.caminho]);
    await admin.from("os_fotos").delete().eq("id", fotoId);
    return falha("O arquivo não é uma foto válida.");
  }
  const { error } = await ctx.supabase.rpc("os_foto_confirmar", { p_foto_id: fotoId });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/e/${empresaId}/os`, "layout");
  return sucesso("Foto anexada.");
}

export async function excluirFotoOs(empresaId: string, fotoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso às ordens de serviço desta empresa.");
  if (!UUID.test(fotoId)) return falha("Foto inválida.");
  const { data: caminho, error } = await ctx.supabase.rpc("os_foto_excluir", { p_foto_id: fotoId });
  if (error) return falha(mensagemErro(error));
  if (typeof caminho === "string" && caminho.startsWith(`${empresaId}/`)) await criarClienteAdmin().storage.from(BUCKET).remove([caminho]);
  revalidatePath(`/e/${empresaId}/os`, "layout");
  return sucesso("Foto excluída.");
}
