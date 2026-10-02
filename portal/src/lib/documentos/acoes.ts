"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEquipe, obterContextoEmpresa } from "@/lib/auth/sessao";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import { lerValorBR } from "@/lib/dinheiro";
import { processarFilaDepois } from "@/lib/jobs/disparo";

const UUID = /^[0-9a-f-]{36}$/i;

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath("/escritorio/documentos");
  revalidatePath("/escritorio/pendencias");
}

export interface Duplicado {
  id: string;
  nome: string;
  competencia: string;
  enviado_em: string;
  status: string | null;
  categoria: string;
}

export type InicioEnvio =
  | { situacao: "duplicado"; duplicado: Duplicado }
  | { situacao: "pronto"; documentoId: string; versaoId: string; caminho: string; token: string; url: string };

const esquemaEnvio = z.object({
  categoria: z.string().min(1, "Selecione a categoria do documento."),
  competencia: z.string().min(1, "Informe a competência."),
  nome: z.string().trim().min(1).max(255, "Nome de arquivo muito longo."),
  mime: z.string().max(150).default("application/octet-stream"),
  tamanho: z.number().int().positive("Arquivo vazio."),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "Assinatura do arquivo inválida."),
  observacao: z.string().max(2000).optional().nullable(),
  itemId: z.string().regex(UUID).optional().nullable(),
  origem: z.enum(["upload", "camera"]).default("upload"),
  forcarDuplicado: z.boolean().default(false),
  titulo: z.string().max(200).optional().nullable(),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  valor: z.string().max(30).optional().nullable(),
});

export type DadosEnvio = z.input<typeof esquemaEnvio>;

/** URL temporária de envio direto ao armazenamento privado (somente para o caminho criado pelo banco). */
async function urlDeEnvio(caminho: string) {
  const admin = criarClienteAdmin();
  const { data, error } = await admin.storage.from("documentos").createSignedUploadUrl(caminho);
  if (error || !data) throw new Error("Não foi possível preparar o envio do arquivo. Tente novamente.");
  return data;
}

/**
 * 1ª etapa do envio: registra o documento (o banco valida permissão, categoria,
 * formato, tamanho e duplicidade) e devolve uma URL temporária para o arquivo.
 */
export async function iniciarEnvio(empresaId: string, entrada: DadosEnvio): Promise<ResultadoAcao<InicioEnvio>> {
  const ctx = await obterContextoEmpresa(empresaId);
  const dados = esquemaEnvio.safeParse(entrada);
  if (!dados.success) return falhaValidacao(dados.error);
  const d = dados.data;
  const comp = lerCompetencia(d.competencia);
  if (!comp) return falha("Competência inválida.");
  let valor: string | undefined;
  if (d.valor) {
    const v = lerValorBR(d.valor);
    if (!v) return falha("Valor inválido.");
    valor = v.toFixed(2);
  }

  const { data, error } = await ctx.supabase.rpc("criar_documento", {
    p_empresa_id: empresaId,
    p_competencia: comp,
    p_categoria: d.categoria,
    p_nome_arquivo: d.nome,
    p_mime: d.mime || "application/octet-stream",
    p_tamanho: d.tamanho,
    p_sha256: d.sha256,
    p_observacao: d.observacao ?? undefined,
    p_checklist_item_id: d.itemId ?? undefined,
    p_origem: d.origem,
    p_forcar_duplicado: d.forcarDuplicado,
    p_titulo: d.titulo ?? undefined,
    p_vencimento: d.vencimento ?? undefined,
    p_valor: valor as unknown as number | undefined,
  });
  if (error) return falha(mensagemErro(error));
  const r = data as unknown as { situacao: string; duplicado?: Duplicado; documento_id?: string; versao_id?: string; storage_path?: string };
  if (r.situacao === "duplicado" && r.duplicado) return sucesso(undefined, { situacao: "duplicado", duplicado: r.duplicado });

  try {
    const envio = await urlDeEnvio(r.storage_path!);
    return sucesso(undefined, {
      situacao: "pronto",
      documentoId: r.documento_id!,
      versaoId: r.versao_id!,
      caminho: r.storage_path!,
      token: envio.token,
      url: envio.signedUrl,
    });
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Falha ao preparar o envio.");
  }
}

/** 2ª etapa: confirma que o arquivo chegou e agenda a verificação/leitura. */
export async function concluirEnvio(
  empresaId: string,
  versaoId: string,
): Promise<ResultadoAcao<{ documentoId: string; recebidoAposFechamento: boolean }>> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!UUID.test(versaoId)) return falha("Envio inválido.");
  const { data, error } = await ctx.supabase.rpc("confirmar_upload", { p_versao_id: versaoId });
  if (error) return falha(mensagemErro(error));
  const r = data as unknown as { documento_id: string; recebido_apos_fechamento?: boolean };
  processarFilaDepois({ tipos: ["processar_documento", "enviar_envio"] });
  revalidar(empresaId);
  return sucesso(undefined, { documentoId: r.documento_id, recebidoAposFechamento: Boolean(r.recebido_apos_fechamento) });
}

const esquemaSubstituicao = z.object({
  nome: z.string().trim().min(1).max(255),
  mime: z.string().max(150).default("application/octet-stream"),
  tamanho: z.number().int().positive("Arquivo vazio."),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  motivo: z.string().trim().min(3, "Informe o motivo da substituição.").max(1000),
});

/** Nova versão de um documento (a versão anterior é preservada). */
export async function iniciarSubstituicao(
  empresaId: string,
  documentoId: string,
  entrada: z.input<typeof esquemaSubstituicao>,
): Promise<ResultadoAcao<Extract<InicioEnvio, { situacao: "pronto" }>>> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!UUID.test(documentoId)) return falha("Documento inválido.");
  const dados = esquemaSubstituicao.safeParse(entrada);
  if (!dados.success) return falhaValidacao(dados.error);
  const d = dados.data;
  const { data, error } = await ctx.supabase.rpc("substituir_documento", {
    p_documento_id: documentoId,
    p_nome_arquivo: d.nome,
    p_mime: d.mime || "application/octet-stream",
    p_tamanho: d.tamanho,
    p_sha256: d.sha256,
    p_motivo: d.motivo,
  });
  if (error) return falha(mensagemErro(error));
  const r = data as unknown as { documento_id: string; versao_id: string; storage_path: string };
  try {
    const envio = await urlDeEnvio(r.storage_path);
    return sucesso(undefined, { situacao: "pronto", documentoId: r.documento_id, versaoId: r.versao_id, caminho: r.storage_path, token: envio.token, url: envio.signedUrl });
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Falha ao preparar o envio.");
  }
}

const STATUS = ["recebido", "em_analise", "aprovado", "correcao"] as const;

async function aplicarStatus(
  supabase: Awaited<ReturnType<typeof obterContextoEmpresa>>["supabase"],
  ids: string[],
  status: (typeof STATUS)[number],
  motivo: string,
  incluirZip: boolean,
) {
  let alvo = ids.filter((id) => UUID.test(id));
  if (incluirZip && alvo.length) {
    // Arquivos extraídos de ZIPs selecionados acompanham a decisão
    const { data: filhos } = await supabase
      .from("documentos")
      .select("id")
      .in("zip_origem_id", alvo)
      .is("excluido_em", null)
      .neq("status", status);
    alvo = [...new Set([...alvo, ...(filhos ?? []).map((f) => f.id)])];
  }
  let ok = 0;
  const erros: string[] = [];
  for (const id of alvo) {
    const { error } = await supabase.rpc("alterar_status_documento", { p_documento_id: id, p_status: status, p_motivo: motivo || undefined });
    if (error) erros.push(mensagemErro(error));
    else ok++;
  }
  return { ok, erros };
}

function mensagemStatus(ok: number, erros: string[], status: string) {
  const rotulo = { recebido: "recebido(s)", em_analise: "em análise", aprovado: "aprovado(s)", correcao: "com correção solicitada" }[status] ?? status;
  if (!erros.length) return sucesso(`${ok} documento(s) marcado(s) como ${rotulo}.`);
  if (!ok) return falha(erros[0]);
  return sucesso(`${ok} documento(s) atualizado(s); ${erros.length} não puderam ser alterados: ${erros[0]}`);
}

/** Conferência pelo escritório (a aprovação é interna e não é validação fiscal). */
export async function alterarStatusDocumentos(
  empresaId: string,
  ids: string[],
  status: string,
  motivo = "",
  incluirZip = true,
): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.revisar")) return falha("Sem permissão para conferir documentos.");
  if (!STATUS.includes(status as (typeof STATUS)[number])) return falha("Status inválido.");
  if (status === "correcao" && !motivo.trim()) return falha("Explique ao cliente o que precisa ser corrigido.");
  const r = await aplicarStatus(ctx.supabase, ids, status as (typeof STATUS)[number], motivo, incluirZip);
  processarFilaDepois({ tipos: ["enviar_envio"] });
  revalidar(empresaId);
  return mensagemStatus(r.ok, r.erros, status);
}

/** Mesma ação, na fila de conferência do escritório (várias empresas). */
export async function alterarStatusEmLote(ids: string[], status: string, motivo = "", incluirZip = true): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  if (!STATUS.includes(status as (typeof STATUS)[number])) return falha("Status inválido.");
  if (status === "correcao" && !motivo.trim()) return falha("Explique ao cliente o que precisa ser corrigido.");
  if (ids.length > 500) return falha("Selecione no máximo 500 documentos por vez.");
  const r = await aplicarStatus(s.supabase, ids, status as (typeof STATUS)[number], motivo, incluirZip);
  processarFilaDepois({ tipos: ["enviar_envio"] });
  revalidatePath("/escritorio/documentos");
  revalidatePath("/escritorio/pendencias");
  return mensagemStatus(r.ok, r.erros, status);
}

export async function reclassificarDocumento(empresaId: string, documentoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const comp = lerCompetencia(String(fd.get("competencia") ?? ""));
  if (!comp) return falha("Competência inválida.", { competencia: ["Informe a competência."] });
  const item = String(fd.get("checklist_item_id") ?? "");
  const valorTexto = String(fd.get("valor") ?? "").trim();
  const valor = valorTexto ? lerValorBR(valorTexto) : null;
  if (valorTexto && !valor) return falha("Valor inválido.", { valor: ["Use o formato 1.234,56."] });
  const vencimento = String(fd.get("vencimento") ?? "");
  const { error } = await ctx.supabase.rpc("atualizar_documento", {
    p_documento_id: documentoId,
    p_categoria: String(fd.get("categoria") ?? ""),
    p_competencia: comp,
    p_observacao: String(fd.get("observacao") ?? ""),
    p_checklist_item_id: UUID.test(item) ? item : undefined,
    p_titulo: String(fd.get("titulo") ?? ""),
    p_vencimento: /^\d{4}-\d{2}-\d{2}$/.test(vencimento) ? vencimento : undefined,
    p_valor: valor ? (valor.toFixed(2) as unknown as number) : undefined,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Classificação atualizada.");
}

export async function excluirDocumento(empresaId: string, documentoId: string, motivo: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!motivo.trim()) return falha("Informe o motivo da exclusão.");
  const { error } = await ctx.supabase.rpc("excluir_documento", { p_documento_id: documentoId, p_motivo: motivo });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Documento excluído. O histórico foi preservado.");
}

export async function avaliarAposFechamento(empresaId: string, documentoId: string, parecer: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("avaliar_documento_apos_fechamento", { p_documento_id: documentoId, p_parecer: parecer });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Avaliação registrada.");
}

export async function reprocessarDocumento(empresaId: string, documentoId: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { error } = await ctx.supabase.rpc("reprocessar_documento", { p_documento_id: documentoId });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["processar_documento"] });
  revalidar(empresaId);
  return sucesso("Leitura do documento agendada novamente.");
}

/** Aplica a sugestão de categoria/competência gerada pela leitura do arquivo (após confirmação humana). */
export async function aplicarSugestao(empresaId: string, documentoId: string): Promise<ResultadoAcao> {
  const ctx = await obterContextoEmpresa(empresaId);
  const { data: doc, error: e1 } = await ctx.supabase
    .from("documentos")
    .select("categoria_codigo, competencia, observacao, checklist_item_id, titulo, vencimento, valor, sugestao")
    .eq("id", documentoId)
    .single();
  if (e1 || !doc) return falha("Documento não encontrado.");
  const s = (doc.sugestao ?? {}) as { categoria?: string; competencia?: string };
  if (!s.categoria && !s.competencia) return falha("Não há sugestão para aplicar.");
  const novaComp = s.competencia ?? doc.competencia;
  const { error } = await ctx.supabase.rpc("atualizar_documento", {
    p_documento_id: documentoId,
    p_categoria: s.categoria ?? doc.categoria_codigo,
    p_competencia: novaComp,
    p_observacao: doc.observacao ?? "",
    // O item do checklist é de uma competência específica: ao mudar a competência, o vínculo é desfeito.
    p_checklist_item_id: novaComp === doc.competencia ? (doc.checklist_item_id ?? undefined) : undefined,
    p_titulo: doc.titulo ?? "",
    p_vencimento: doc.vencimento ?? undefined,
    p_valor: doc.valor ?? undefined,
  });
  if (error) return falha(mensagemErro(error));
  // O histórico do documento registra a reclassificação (antes/depois).
  revalidar(empresaId);
  return sucesso("Sugestão aplicada.");
}
