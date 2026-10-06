"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { EXTENSAO_IMAGEM, tipoImagem } from "@/lib/imagens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "empresas-logos";

async function contextoEdicao(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode("empresa.editar") ? ctx : null;
}

function revalidar(empresaId: string) {
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  revalidatePath(`/e/${empresaId}`, "layout");
}

/** Logo da empresa: PNG ou JPEG até 2 MB, conferindo o conteúdo real; fica na pasta da empresa, num armazenamento privado. */
export async function enviarLogoEmpresa(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contextoEdicao(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar o cadastro desta empresa.");
  const arquivo = fd.get("logo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha o arquivo da logo.", { logo: ["Escolha um arquivo PNG ou JPG."] });
  if (arquivo.size > 2 * 1024 * 1024) return falha("Arquivo grande demais.", { logo: ["A logo deve ter até 2 MB."] });
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = tipoImagem(bytes);
  if (!tipo) return falha("Formato não aceito.", { logo: ["Use PNG ou JPG (o arquivo enviado não é uma imagem nesses formatos)."] });
  const caminho = `${empresaId}/logo-${Date.now()}.${EXTENSAO_IMAGEM[tipo]}`;
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: tipo, upsert: false });
  if (error) return falha(`Não foi possível enviar a logo: ${error.message}`);
  const { data: anterior } = await ctx.supabase.from("empresas").select("logo_path").eq("id", empresaId).single();
  const { error: e2 } = await ctx.supabase.from("empresas").update({ logo_path: caminho, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId);
  if (e2) {
    await ctx.supabase.storage.from(BUCKET).remove([caminho]);
    return falha(mensagemErro(e2));
  }
  if (anterior?.logo_path && anterior.logo_path !== caminho) await ctx.supabase.storage.from(BUCKET).remove([anterior.logo_path]);
  revalidar(empresaId);
  return sucesso("Logo da empresa atualizada.");
}

export async function removerLogoEmpresa(empresaId: string): Promise<ResultadoAcao> {
  const ctx = await contextoEdicao(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar o cadastro desta empresa.");
  const { data: anterior } = await ctx.supabase.from("empresas").select("logo_path").eq("id", empresaId).single();
  const { error } = await ctx.supabase.from("empresas").update({ logo_path: null, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (anterior?.logo_path) await ctx.supabase.storage.from(BUCKET).remove([anterior.logo_path]);
  revalidar(empresaId);
  return sucesso("Logo da empresa removida.");
}
