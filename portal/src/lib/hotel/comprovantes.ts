"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { LIMITE_COMPROVANTE, MIMES_COMPROVANTE, assinaturaConfere } from "./comprovante-arquivo";

const BUCKET = "hotel-comprovantes";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/hotel`, "layout");
  revalidatePath(`/e/${empresaId}/loja`, "layout");
}

async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.loja || ctx.acesso.gestao_modalidade !== "hotel" || !ctx.pode("gestao.vender")) return null;
  return ctx;
}

/**
 * 1ª etapa: o banco registra o comprovante do recebimento (confere permissão,
 * formato e tamanho) e o servidor devolve uma URL temporária para o arquivo
 * ir direto do navegador ao armazenamento privado.
 */
export async function iniciarComprovante(
  empresaId: string,
  pagamentoId: string,
  dados: { nome: string; mime: string; tamanho: number; origem: "camera" | "arquivo" },
): Promise<ResultadoAcao<{ anexoId: string; url: string }>> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso à recepção do hotel.");
  if (!UUID.test(pagamentoId)) return falha("Recebimento inválido.");
  if (!MIMES_COMPROVANTE.has(dados.mime)) return falha("Envie uma foto (JPG, PNG, WEBP ou HEIC) ou um PDF.");
  if (!Number.isInteger(dados.tamanho) || dados.tamanho <= 0 || dados.tamanho > LIMITE_COMPROVANTE) return falha("O comprovante pode ter até 10 MB.");
  const { data, error } = await ctx.supabase.rpc("hotel_comprovante_iniciar", {
    p_pagamento_id: pagamentoId,
    p_dados: { nome: String(dados.nome ?? "").slice(0, 200), mime: dados.mime, tamanho: dados.tamanho, origem: dados.origem === "camera" ? "camera" : "arquivo" },
  });
  if (error) return falha(mensagemErro(error));
  const r = data as { anexo_id: string; caminho: string };
  if (!r?.caminho?.startsWith(`${empresaId}/`)) return falha("Não foi possível preparar o envio.");
  const { data: envio, error: e2 } = await criarClienteAdmin().storage.from(BUCKET).createSignedUploadUrl(r.caminho);
  if (e2 || !envio) return falha("Não foi possível preparar o envio do arquivo. Tente novamente.");
  return sucesso(undefined, { anexoId: r.anexo_id, url: envio.signedUrl });
}

/** 2ª etapa: confere o tipo real do arquivo que chegou e confirma o comprovante. */
export async function concluirComprovante(empresaId: string, anexoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso à recepção do hotel.");
  if (!UUID.test(anexoId)) return falha("Comprovante inválido.");
  const { data: anexo } = await ctx.supabase
    .from("hotel_pagamento_anexos")
    .select("empresa_id, caminho, mime, enviado_por, confirmado_em")
    .eq("id", anexoId)
    .maybeSingle();
  if (!anexo || anexo.empresa_id !== empresaId) return falha("Comprovante não encontrado.");
  if (anexo.enviado_por !== ctx.sessao.usuarioId) return falha("Somente quem iniciou o envio pode confirmá-lo.");
  if (anexo.confirmado_em) return sucesso("Comprovante anexado.");
  const admin = criarClienteAdmin();
  const { data: arquivo } = await admin.storage.from(BUCKET).download(anexo.caminho);
  if (!arquivo) return falha("O arquivo não chegou ao armazenamento. Tente enviar novamente.");
  if (!assinaturaConfere(anexo.mime, new Uint8Array(await arquivo.slice(0, 16).arrayBuffer()))) {
    await admin.storage.from(BUCKET).remove([anexo.caminho]);
    await admin.from("hotel_pagamento_anexos").delete().eq("id", anexoId);
    return falha("O arquivo não é uma foto nem um PDF válido.");
  }
  const { error } = await ctx.supabase.rpc("hotel_comprovante_confirmar", { p_anexo_id: anexoId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Comprovante anexado.");
}

/** Exclui o comprovante (quem enviou, com o caixa aberto, ou o gerente) e apaga o arquivo. */
export async function excluirComprovante(empresaId: string, anexoId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso à recepção do hotel.");
  if (!UUID.test(anexoId)) return falha("Comprovante inválido.");
  const { data: caminho, error } = await ctx.supabase.rpc("hotel_comprovante_excluir", { p_anexo_id: anexoId });
  if (error) return falha(mensagemErro(error));
  if (typeof caminho === "string" && caminho.startsWith(`${empresaId}/`)) await criarClienteAdmin().storage.from(BUCKET).remove([caminho]);
  revalidar(empresaId);
  return sucesso("Comprovante excluído.");
}
