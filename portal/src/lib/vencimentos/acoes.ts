"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissao } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { TIPOS_VENCIMENTO } from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/vencimentos`);
  revalidatePath("/escritorio/vencimentos");
}

export async function salvarVencimento(empresaId: string, vencimentoId: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || (vencimentoId && !UUID.test(vencimentoId))) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "documentos.enviar");
  const erros: Record<string, string[]> = {};
  const tipo = texto(fd, "tipo");
  if (!TIPOS_VENCIMENTO[tipo]) erros.tipo = ["Escolha o tipo."];
  const descricao = texto(fd, "descricao") || (TIPOS_VENCIMENTO[tipo]?.rotulo ?? "");
  if (descricao.length < 3 || descricao.length > 120) erros.descricao = ["Descreva o documento (3 a 120 caracteres)."];
  const validade = texto(fd, "validade");
  if (!DATA.test(validade)) erros.validade = ["Informe a data de validade."];
  const emissao = texto(fd, "emissao") || null;
  if (emissao && (!DATA.test(emissao) || emissao > validade)) erros.emissao = ["A emissão precisa ser antes da validade."];
  const responsavel = texto(fd, "responsavel") || "escritorio";
  if (!["escritorio", "cliente"].includes(responsavel)) erros.responsavel = ["Escolha quem renova."];
  const documento = texto(fd, "documento_id");
  if (documento && !UUID.test(documento)) erros.documento_id = ["Documento inválido."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const registro = {
    empresa_id: empresaId,
    tipo,
    descricao,
    numero: texto(fd, "numero").slice(0, 80) || null,
    orgao: texto(fd, "orgao").slice(0, 120) || null,
    emissao,
    validade,
    responsavel,
    documento_id: documento || null,
    observacao: texto(fd, "observacao").slice(0, 500) || null,
  };
  const { error } = vencimentoId
    ? await ctx.supabase.from("vencimentos").update(registro).eq("id", vencimentoId).eq("empresa_id", empresaId)
    : await ctx.supabase.from("vencimentos").insert({ ...registro, criado_por: ctx.sessao.usuarioId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(vencimentoId ? "Vencimento atualizado." : "Vencimento cadastrado. O portal avisa 30, 15 e 5 dias antes.");
}

export async function arquivarVencimento(empresaId: string, vencimentoId: string, arquivar: boolean): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(vencimentoId)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "documentos.enviar");
  const { error, count } = await ctx.supabase
    .from("vencimentos")
    .update({ situacao: arquivar ? "arquivado" : "ativo" }, { count: "exact" })
    .eq("id", vencimentoId)
    .eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Registro não encontrado.");
  revalidar(empresaId);
  return sucesso(arquivar ? "Arquivado: não gera mais avisos." : "Reativado.");
}

export async function excluirVencimento(empresaId: string, vencimentoId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(vencimentoId)) return falha("Registro inválido.");
  const ctx = await exigirPermissao(empresaId, "empresa.editar");
  const { error, count } = await ctx.supabase.from("vencimentos").delete({ count: "exact" }).eq("id", vencimentoId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Registro não encontrado.");
  revalidar(empresaId);
  return sucesso("Excluído.");
}
