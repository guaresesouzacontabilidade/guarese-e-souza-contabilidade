"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { booleano, dataObrigatoria, textoOpcional, uuidOpcional } from "@/lib/validacao";
import { lerCompetencia } from "@/lib/competencia";

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath(`/escritorio/empresas/${empresaId}`);
  revalidatePath("/escritorio/pendencias");
}

const esquemaModelo = z.object({
  id: uuidOpcional,
  categoria_codigo: z.string().min(1, "Selecione a categoria."),
  titulo: z.string().trim().min(3, "Informe o título."),
  descricao: textoOpcional,
  obrigatorio: z.boolean(),
  quantidade_minima: z.coerce.number().int().min(1).max(100),
  por_conta: z.boolean(),
  tipos_conta: z.array(z.string()),
  dia_prazo: z.coerce.number().int().min(1, "Dia inválido.").max(31, "Dia inválido."),
  meses_apos: z.coerce.number().int().min(0).max(3),
  periodicidade: z.enum(["mensal", "trimestral", "anual"]),
  meses: z.array(z.coerce.number().int().min(1).max(12)),
  responsavel_cliente_id: uuidOpcional,
  responsavel_equipe_id: uuidOpcional,
  ativo: z.boolean(),
});

export async function salvarModelo(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("checklist.gerenciar")) return falha("Sem permissão para configurar o checklist.");
  const dados = esquemaModelo.safeParse({
    id: String(fd.get("id") ?? ""),
    categoria_codigo: String(fd.get("categoria_codigo") ?? ""),
    titulo: String(fd.get("titulo") ?? ""),
    descricao: String(fd.get("descricao") ?? ""),
    obrigatorio: booleano(fd, "obrigatorio"),
    quantidade_minima: fd.get("quantidade_minima") || 1,
    por_conta: booleano(fd, "por_conta"),
    tipos_conta: fd.getAll("tipos_conta").map(String),
    dia_prazo: fd.get("dia_prazo") || 10,
    meses_apos: fd.get("meses_apos") ?? 1,
    periodicidade: fd.get("periodicidade") ?? "mensal",
    meses: fd.getAll("meses").map(String),
    responsavel_cliente_id: String(fd.get("responsavel_cliente_id") ?? ""),
    responsavel_equipe_id: String(fd.get("responsavel_equipe_id") ?? ""),
    ativo: fd.get("ativo") === null ? true : booleano(fd, "ativo"),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { id, ...c } = dados.data;
  if (c.periodicidade !== "mensal" && c.meses.length === 0) return falha("Selecione os meses em que o item é exigido.");
  const registro = {
    ...c,
    tipos_conta: c.por_conta ? (c.tipos_conta.length ? c.tipos_conta : null) : null,
    meses: c.periodicidade === "mensal" ? null : c.meses,
  };
  const { error } = id
    ? await ctx.supabase.from("checklist_modelos").update(registro).eq("id", id).eq("empresa_id", empresaId)
    : await ctx.supabase.from("checklist_modelos").insert({ ...registro, empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(id ? "Item do modelo atualizado. Vale para as próximas competências geradas." : "Item adicionado ao modelo de checklist.");
}

export async function aplicarChecklistPadrao(empresaId: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("checklist.gerenciar")) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("aplicar_checklist_padrao", { p_empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Itens padrão aplicados conforme regime e serviços (itens existentes foram mantidos).");
}

export async function gerarChecklist(empresaId: string, competencia: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const comp = lerCompetencia(competencia);
  if (!comp) return falha("Competência inválida.");
  const { data, error } = await ctx.supabase.rpc("gerar_checklist_competencia", { p_empresa_id: empresaId, p_competencia: comp });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(data ? `${data} item(ns) gerado(s).` : "Checklist já estava atualizado.");
}

export async function solicitarNaoAplica(empresaId: string, itemId: string, justificativa: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("solicitar_nao_aplica", { p_item_id: itemId, p_justificativa: justificativa });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(ctx.pode("checklist.gerenciar") ? "Item marcado como “não se aplica”." : "Solicitação enviada ao escritório para revisão.");
}

export async function revisarNaoAplica(empresaId: string, itemId: string, aprovar: boolean, resposta: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("revisar_nao_aplica", { p_item_id: itemId, p_aprovar: aprovar, p_resposta: resposta || undefined });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso(aprovar ? "“Não se aplica” aprovado." : "Solicitação recusada; o cliente foi avisado.");
}

export async function concluirItem(empresaId: string, itemId: string, observacao: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("concluir_item_checklist", { p_item_id: itemId, p_observacao: observacao || undefined });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Item concluído.");
}

export async function reabrirItem(empresaId: string, itemId: string, motivo: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("reabrir_item_checklist", { p_item_id: itemId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Item reaberto.");
}

export async function solicitarCorrecaoItem(empresaId: string, itemId: string, motivo: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("solicitar_correcao_item", { p_item_id: itemId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Correção solicitada ao cliente.");
}

const esquemaItem = z.object({
  competencia: z.string(),
  categoria_codigo: z.string().min(1, "Selecione a categoria."),
  titulo: z.string().trim().min(3, "Informe o título."),
  descricao: textoOpcional,
  prazo: dataObrigatoria("Informe o prazo."),
  obrigatorio: z.boolean(),
  quantidade_minima: z.coerce.number().int().min(1).max(100),
  responsavel_cliente_id: uuidOpcional,
  responsavel_equipe_id: uuidOpcional,
});

export async function adicionarItem(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("checklist.gerenciar")) return falha("Sem permissão.");
  const dados = esquemaItem.safeParse({
    competencia: String(fd.get("competencia") ?? ""),
    categoria_codigo: String(fd.get("categoria_codigo") ?? ""),
    titulo: String(fd.get("titulo") ?? ""),
    descricao: String(fd.get("descricao") ?? ""),
    prazo: String(fd.get("prazo") ?? ""),
    obrigatorio: booleano(fd, "obrigatorio"),
    quantidade_minima: fd.get("quantidade_minima") || 1,
    responsavel_cliente_id: String(fd.get("responsavel_cliente_id") ?? ""),
    responsavel_equipe_id: String(fd.get("responsavel_equipe_id") ?? ""),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const comp = lerCompetencia(dados.data.competencia);
  if (!comp) return falha("Competência inválida.");
  const d = dados.data;
  const { error } = await ctx.supabase.rpc("adicionar_item_checklist", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_categoria: d.categoria_codigo,
    p_titulo: d.titulo,
    p_descricao: d.descricao ?? "",
    p_prazo: d.prazo,
    p_obrigatorio: d.obrigatorio,
    p_quantidade_minima: d.quantidade_minima,
    p_responsavel_cliente_id: d.responsavel_cliente_id ?? undefined,
    p_responsavel_equipe_id: d.responsavel_equipe_id ?? undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Documento solicitado ao cliente.");
}

export async function atualizarItem(empresaId: string, itemId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("checklist.gerenciar")) return falha("Sem permissão.");
  const { error } = await ctx.supabase.rpc("atualizar_item_checklist", {
    p_item_id: itemId,
    p_titulo: String(fd.get("titulo") ?? ""),
    p_descricao: String(fd.get("descricao") ?? ""),
    p_prazo: String(fd.get("prazo") ?? "") || (undefined as unknown as string),
    p_obrigatorio: booleano(fd, "obrigatorio"),
    p_quantidade_minima: Number(fd.get("quantidade_minima") || 1),
    p_responsavel_cliente_id: (String(fd.get("responsavel_cliente_id") ?? "") || null) as string,
    p_responsavel_equipe_id: (String(fd.get("responsavel_equipe_id") ?? "") || null) as string,
    p_observacao_equipe: String(fd.get("observacao_equipe") ?? ""),
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Item atualizado.");
}

export async function enviarLembrete(empresaId: string, competencia: string, mensagem: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("checklist.gerenciar")) return falha("Sem permissão.");
  const comp = lerCompetencia(competencia);
  if (!comp) return falha("Competência inválida.");
  const { error } = await ctx.supabase.rpc("enviar_lembrete_manual", { p_empresa_id: empresaId, p_competencia: comp, p_mensagem: mensagem || undefined });
  if (error) return falha(mensagemErro(error));
  const { processarFilaDepois } = await import("@/lib/jobs/disparo");
  processarFilaDepois();
  revalidar(empresaId);
  return sucesso("Lembrete enviado aos responsáveis da empresa (portal e e-mail).");
}
