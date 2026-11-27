"use server";

import { revalidatePath } from "next/cache";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { assinaturaConfere } from "@/lib/hotel/comprovante-arquivo";
import { obterContextoRh } from "./dados";

/**
 * Evidências das tarefas (foto do pátio organizado, comprovante...): o banco
 * registra (permissão, formato, tamanho, até 10 por tarefa) e o servidor
 * devolve uma URL temporária para o arquivo ir direto do navegador ao
 * armazenamento privado; depois o tipo real do arquivo é conferido.
 */

const BUCKET = "rh-evidencias";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const LIMITE = 10 * 1024 * 1024;

async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoRh(empresaId);
  return ctx.fazTarefas || ctx.gestor ? ctx : null;
}

export async function iniciarEvidencia(
  empresaId: string,
  tarefaId: string,
  dados: { mime: string; tamanho: number; legenda?: string },
): Promise<ResultadoAcao<{ evidenciaId: string; url: string }>> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso às tarefas desta empresa.");
  if (!UUID.test(tarefaId)) return falha("Tarefa inválida.");
  if (!MIMES.has(dados.mime))
    return falha("Envie uma foto (JPG, PNG, WEBP ou HEIC) ou um PDF.");
  if (
    !Number.isInteger(dados.tamanho) ||
    dados.tamanho <= 0 ||
    dados.tamanho > LIMITE
  )
    return falha("O arquivo pode ter até 10 MB.");
  const { data, error } = await ctx.supabase.rpc("rh_evidencia_iniciar", {
    p_tarefa_id: tarefaId,
    p_dados: {
      mime: dados.mime,
      tamanho: dados.tamanho,
      legenda: String(dados.legenda ?? "").slice(0, 200),
    },
  });
  if (error) return falha(mensagemErro(error));
  const r = data as { evidencia_id: string; caminho: string };
  if (!r?.caminho?.startsWith(`${empresaId}/${tarefaId}/`))
    return falha("Não foi possível preparar o envio.");
  const { data: envio, error: e2 } = await criarClienteAdmin()
    .storage.from(BUCKET)
    .createSignedUploadUrl(r.caminho);
  if (e2 || !envio)
    return falha(
      "Não foi possível preparar o envio do arquivo. Tente novamente.",
    );
  return sucesso(undefined, {
    evidenciaId: r.evidencia_id,
    url: envio.signedUrl,
  });
}

export async function concluirEvidencia(
  empresaId: string,
  evidenciaId: string,
): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso às tarefas desta empresa.");
  if (!UUID.test(evidenciaId)) return falha("Anexo inválido.");
  const { data: ev } = await ctx.supabase
    .from("rh_tarefa_evidencias")
    .select("empresa_id, caminho, mime, enviado_por, confirmado_em")
    .eq("id", evidenciaId)
    .maybeSingle();
  if (!ev || ev.empresa_id !== empresaId) return falha("Anexo não encontrado.");
  if (ev.enviado_por !== ctx.sessao.usuarioId)
    return falha("Somente quem iniciou o envio pode confirmá-lo.");
  if (ev.confirmado_em) return sucesso("Arquivo anexado.");
  const admin = criarClienteAdmin();
  const { data: arquivo } = await admin.storage
    .from(BUCKET)
    .download(ev.caminho);
  if (!arquivo)
    return falha(
      "O arquivo não chegou ao armazenamento. Tente enviar novamente.",
    );
  const cabeca = new Uint8Array(await arquivo.slice(0, 16).arrayBuffer());
  const ehPdf =
    cabeca[0] === 0x25 &&
    cabeca[1] === 0x50 &&
    cabeca[2] === 0x44 &&
    cabeca[3] === 0x46;
  if (
    ev.mime === "application/pdf" ? !ehPdf : !assinaturaConfere(ev.mime, cabeca)
  ) {
    await admin.storage.from(BUCKET).remove([ev.caminho]);
    await admin.from("rh_tarefa_evidencias").delete().eq("id", evidenciaId);
    return falha("O arquivo não é uma foto ou um PDF válido.");
  }
  const { error } = await ctx.supabase.rpc("rh_evidencia_confirmar", {
    p_evidencia_id: evidenciaId,
  });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/e/${empresaId}/rh`, "layout");
  return sucesso("Arquivo anexado.");
}

export async function excluirEvidencia(
  empresaId: string,
  evidenciaId: string,
): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Você não tem acesso às tarefas desta empresa.");
  if (!UUID.test(evidenciaId)) return falha("Anexo inválido.");
  const { data: caminho, error } = await ctx.supabase.rpc(
    "rh_evidencia_excluir",
    { p_evidencia_id: evidenciaId },
  );
  if (error) return falha(mensagemErro(error));
  if (typeof caminho === "string" && caminho.startsWith(`${empresaId}/`))
    await criarClienteAdmin().storage.from(BUCKET).remove([caminho]);
  revalidatePath(`/e/${empresaId}/rh`, "layout");
  return sucesso("Anexo excluído.");
}
