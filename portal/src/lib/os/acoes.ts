"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { envPublico } from "@/lib/env";
import { cifrar, decifrar, ErroChaveCertificados } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { enviarModeloWhatsapp } from "@/lib/whatsapp/cloud-api";
import { assinaturaValida, parametrosAvisoOs } from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, nome: string, max = 200) =>
  String(fd.get(nome) ?? "")
    .trim()
    .slice(0, max);

async function contexto(empresaId: string, gerenciar = false) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (ctx.acesso.ferramentas_desligadas.includes("os")) throw new Error("As ordens de serviço não estão ligadas para esta empresa.");
  if (gerenciar ? !ctx.pode("os.gerenciar") : !ctx.pode("os.operar")) {
    throw new Error(gerenciar ? "Só quem gerencia as ordens de serviço faz isso." : "Você não tem acesso às ordens de serviço desta empresa.");
  }
  return ctx;
}

async function executar<T>(fn: () => Promise<ResultadoAcao<T>>): Promise<ResultadoAcao<T>> {
  try {
    return await fn();
  } catch (e) {
    return falha(e instanceof Error ? e.message : "Não foi possível concluir a operação.");
  }
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/os`, "layout");
}

// -----------------------------------------------------------------------------
// Ordem de serviço
// -----------------------------------------------------------------------------
export interface ItemOsEntrada {
  servico_id: string | null;
  descricao: string;
  quantidade: number;
  unidade?: string;
  minutos?: number;
  valor_unitario?: number | null;
}

export interface DadosOs {
  cliente_nome: string;
  cliente_telefone: string;
  cliente_documento: string;
  descricao: string;
  observacoes: string;
  prioridade: string;
  responsavel_id: string | null;
  /** AAAA-MM-DDTHH:MM no horário local (ou vazio) */
  prazo: string;
  /** Avisar pelo WhatsApp quando ficar pronta (se a loja ligou o aviso automático) */
  avisar_whatsapp?: boolean;
  itens: ItemOsEntrada[];
}

/** "2026-11-26T15:00" (horário de Brasília/Tocantins, UTC−3) → ISO. */
function prazoIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return `${v}:00-03:00`;
}

export async function salvarOs(empresaId: string, id: string | null, dados: DadosOs): Promise<ResultadoAcao<{ id: string }>> {
  return executar(async () => {
    if (id && !UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    const erros: Record<string, string[]> = {};
    if ((dados.cliente_nome ?? "").trim().length < 2) erros.cliente_nome = ["Informe o nome do cliente."];
    const itens = (dados.itens ?? []).filter((i) => i.servico_id || (i.descricao ?? "").trim());
    if (!itens.length) erros.itens = ["Inclua ao menos um serviço."];
    if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
    const p: Record<string, Json> = {
      cliente_nome: dados.cliente_nome.trim().slice(0, 120),
      cliente_telefone: (dados.cliente_telefone ?? "").slice(0, 20),
      cliente_documento: (dados.cliente_documento ?? "").slice(0, 20),
      descricao: (dados.descricao ?? "").slice(0, 2000),
      observacoes: (dados.observacoes ?? "").slice(0, 2000),
      prioridade: dados.prioridade || "normal",
      responsavel_id: dados.responsavel_id && UUID.test(dados.responsavel_id) ? dados.responsavel_id : "",
      prazo: dados.prazo ? (prazoIso(dados.prazo) ?? "") : "",
      avisar_whatsapp: dados.avisar_whatsapp !== false,
      itens: itens.slice(0, 60).map((i) => ({
        servico_id: i.servico_id && UUID.test(i.servico_id) ? i.servico_id : "",
        descricao: (i.descricao ?? "").slice(0, 200),
        quantidade: Number(i.quantidade) || 0,
        unidade: (i.unidade ?? "").slice(0, 12),
        minutos: i.servico_id ? "" : String(Number(i.minutos) || 0),
        valor_unitario: i.valor_unitario === null || i.valor_unitario === undefined ? "" : String(i.valor_unitario),
      })),
    };
    const { data, error } = await ctx.supabase.rpc("os_salvar", { p_empresa_id: empresaId, p_id: id as string, p_dados: p });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "OS atualizada." : "OS aberta e colocada na fila.", { id: data as string });
  });
}

/** Previsão de entrega pelos serviços escolhidos (fila de cada setor ou máquina que a OS usa). */
export async function previsaoOs(empresaId: string, itens: { servico_id: string | null; quantidade: number; minutos?: number }[], prioridade: string): Promise<string | null> {
  try {
    const ctx = await contexto(empresaId);
    const lista = (itens ?? []).slice(0, 60).map((i) => ({
      servico_id: i.servico_id && UUID.test(i.servico_id) ? i.servico_id : "",
      quantidade: Math.max(Number(i.quantidade) || 0, 0),
      minutos: Math.max(Number(i.minutos) || 0, 0),
    }));
    const { data } = await ctx.supabase.rpc("os_previsao_itens", { p_empresa_id: empresaId, p_itens: lista, p_prioridade: prioridade });
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function moverOs(empresaId: string, id: string, etapa: string, posicao: number | null, retiradoPor?: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("os_mover", {
      p_id: id,
      p_etapa: etapa,
      p_posicao: posicao === null ? (null as unknown as number) : posicao,
      p_retirado_por: (retiradoPor ?? "").slice(0, 120),
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso();
  });
}

export async function pausarOs(empresaId: string, id: string, motivo: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("os_pausar", { p_id: id, p_motivo: motivo.slice(0, 200) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("OS pausada. O tempo parado não conta como execução.");
  });
}

export async function retomarOs(empresaId: string, id: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("os_retomar", { p_id: id });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("OS retomada.");
  });
}

export async function atribuirOs(empresaId: string, id: string, responsavelId: string | null): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id) || (responsavelId && !UUID.test(responsavelId))) return falha("Dados inválidos.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("os_atribuir", { p_id: id, p_responsavel_id: responsavelId as string });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Responsável atualizado.");
  });
}

export async function cancelarOs(empresaId: string, id: string, motivo: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId, true);
    const { error } = await ctx.supabase.rpc("os_cancelar", { p_id: id, p_motivo: motivo.slice(0, 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("OS cancelada.");
  });
}

// -----------------------------------------------------------------------------
// Serviços, equipe e configuração (os.gerenciar)
// -----------------------------------------------------------------------------
export async function salvarServicoOs(empresaId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (id && !UUID.test(id)) return falha("Serviço inválido.");
    const ctx = await contexto(empresaId, true);
    const nome = texto(fd, "nome", 120);
    if (nome.length < 2) return falha("Revise os campos destacados.", { nome: ["Informe o nome do serviço."] });
    const { error } = await ctx.supabase.rpc("os_servico_salvar", {
      p_empresa_id: empresaId,
      p_id: id as string,
      p_dados: {
        nome,
        unidade: texto(fd, "unidade", 12),
        minutos_por_unidade: texto(fd, "minutos_por_unidade", 12),
        minutos_fixos: texto(fd, "minutos_fixos", 12),
        valor_unitario: texto(fd, "valor_unitario", 16).replace(/\./g, "").replace(",", ".") || "0",
        setor: texto(fd, "setor", 60),
        ativo: fd.get("ativo") !== "off",
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Serviço atualizado." : "Serviço cadastrado.");
  });
}

export async function ativarServicoOs(empresaId: string, id: string, ativo: boolean): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("Serviço inválido.");
    const ctx = await contexto(empresaId, true);
    const { data: s } = await ctx.supabase.from("os_servicos").select("*").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
    if (!s) return falha("Serviço não encontrado.");
    const { error } = await ctx.supabase.rpc("os_servico_salvar", {
      p_empresa_id: empresaId,
      p_id: id,
      p_dados: {
        nome: s.nome,
        unidade: s.unidade,
        minutos_por_unidade: String(s.minutos_por_unidade),
        minutos_fixos: String(s.minutos_fixos),
        valor_unitario: String(s.valor_unitario),
        setor: s.setor ?? "",
        ativo,
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(ativo ? "Serviço reativado." : "Serviço desativado (não aparece nas novas OS).");
  });
}

export async function ajustarEstimativaOs(empresaId: string, id: string, minutosPorUnidade: number): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("Serviço inválido.");
    const ctx = await contexto(empresaId, true);
    const { data: s } = await ctx.supabase.from("os_servicos").select("*").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
    if (!s) return falha("Serviço não encontrado.");
    const { error } = await ctx.supabase.rpc("os_servico_salvar", {
      p_empresa_id: empresaId,
      p_id: id,
      p_dados: {
        nome: s.nome,
        unidade: s.unidade,
        minutos_por_unidade: String(minutosPorUnidade),
        minutos_fixos: String(s.minutos_fixos),
        valor_unitario: String(s.valor_unitario),
        setor: s.setor ?? "",
        ativo: s.ativo,
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`Estimativa de “${s.nome}” ajustada para ${String(minutosPorUnidade).replace(".", ",")} min por ${s.unidade}.`);
  });
}

export async function salvarPessoaOs(empresaId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (id && !UUID.test(id)) return falha("Pessoa inválida.");
    const ctx = await contexto(empresaId, true);
    const nome = texto(fd, "nome", 80);
    if (nome.length < 2) return falha("Revise os campos destacados.", { nome: ["Informe o nome."] });
    const cor = texto(fd, "cor", 7);
    const { error } = await ctx.supabase.rpc("os_equipe_salvar", {
      p_empresa_id: empresaId,
      p_id: id as string,
      p_dados: { nome, cor: /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : "#2563eb", ativo: fd.get("ativo") !== "off" },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Pessoa atualizada." : "Pessoa incluída na equipe.");
  });
}

export async function ativarPessoaOs(empresaId: string, id: string, ativo: boolean): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("Pessoa inválida.");
    const ctx = await contexto(empresaId, true);
    const { data: p } = await ctx.supabase.from("os_equipe").select("*").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
    if (!p) return falha("Pessoa não encontrada.");
    const { error } = await ctx.supabase.rpc("os_equipe_salvar", { p_empresa_id: empresaId, p_id: id, p_dados: { nome: p.nome, cor: p.cor, ativo } });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(ativo ? "Pessoa reativada." : "Pessoa desativada.");
  });
}

export async function configurarOs(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const dias = fd.getAll("dias_semana").map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    if (!dias.length) return falha("Revise os campos destacados.", { dias_semana: ["Escolha os dias de trabalho."] });
    const { error } = await ctx.supabase.rpc("os_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        nome_exibicao: texto(fd, "nome_exibicao", 120),
        telefone: texto(fd, "telefone", 20),
        hora_inicio: texto(fd, "hora_inicio", 5),
        hora_fim: texto(fd, "hora_fim", 5),
        dias_semana: dias,
        executores_simultaneos: texto(fd, "executores_simultaneos", 3),
        mensagem_pronta: texto(fd, "mensagem_pronta", 600),
        rodape_impressao: texto(fd, "rodape_impressao", 1000),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Configuração das OS salva.");
  });
}

// -----------------------------------------------------------------------------
// Recebimentos (caixa da Loja)
// -----------------------------------------------------------------------------
export interface PagamentoOs {
  id: string;
  forma: string;
  valor: number;
  vencimento: string | null;
  sinal: boolean;
  created_at: string;
  cancelado_em: string | null;
  cancelado_motivo: string | null;
  podeEstornar: boolean;
}

export interface ResumoRecebimentoOs {
  numero: number;
  cliente: string;
  etapa: string;
  total: number;
  recebido: number;
  aReceber: number;
  falta: number;
  podeReceber: boolean;
  motivoSemReceber: string | null;
  caixa: { id: string; nome: string } | null;
  exigirAssinatura: boolean;
  exigirPagamento: boolean;
  pagamentos: PagamentoOs[];
}

/** Valores, pagamentos e o caixa aberto de quem está recebendo (para as telas de receber e entregar). */
export async function resumoRecebimentoOs(empresaId: string, id: string): Promise<ResultadoAcao<ResumoRecebimentoOs>> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    const [{ data: o }, { data: pags }, { data: cfg }] = await Promise.all([
      ctx.supabase.from("os_ordens").select("numero, cliente_nome, etapa, valor_total, valor_recebido, valor_a_receber").eq("id", id).eq("empresa_id", empresaId).maybeSingle(),
      ctx.supabase.from("os_pagamentos").select("id, forma, valor, vencimento, sinal, created_at, cancelado_em, cancelado_motivo, registrado_por, sessao_id").eq("ordem_id", id).order("created_at"),
      ctx.supabase.from("os_config").select("exigir_assinatura, exigir_pagamento_entrega").eq("empresa_id", empresaId).maybeSingle(),
    ]);
    if (!o) return falha("OS não encontrada.");
    const loja = ctx.acesso.loja;
    const caixaPerm = ctx.pode("gestao.vender");
    const gerente = ctx.pode("gestao.gerenciar");
    const { data: caixa } =
      loja && caixaPerm
        ? await ctx.supabase.from("caixa_sessoes").select("id, caixa_nome").eq("empresa_id", empresaId).eq("operador_id", ctx.sessao.usuarioId).eq("status", "aberto").order("aberto_em", { ascending: false }).limit(1).maybeSingle()
        : { data: null };
    const sessoes = [...new Set((pags ?? []).map((p) => p.sessao_id).filter((x): x is string => Boolean(x)))];
    const { data: abertas } = sessoes.length && caixaPerm ? await ctx.supabase.from("caixa_sessoes").select("id").in("id", sessoes).eq("status", "aberto") : { data: [] };
    const aberta = new Set((abertas ?? []).map((x) => x.id));
    const total = Number(o.valor_total) || 0;
    const recebido = Number(o.valor_recebido) || 0;
    const aReceber = Number(o.valor_a_receber) || 0;
    return sucesso(undefined, {
      numero: o.numero,
      cliente: o.cliente_nome,
      etapa: o.etapa,
      total,
      recebido,
      aReceber,
      falta: Math.max(Math.round((total - recebido - aReceber) * 100) / 100, 0),
      podeReceber: loja && caixaPerm && o.etapa !== "cancelada",
      motivoSemReceber: !loja
        ? "O recebimento usa o caixa da Loja, que não está ligada para esta empresa. Fale com o escritório."
        : !caixaPerm
          ? "Seu acesso não inclui o caixa da Loja: peça para quem opera o caixa receber."
          : null,
      caixa: caixa ? { id: caixa.id, nome: caixa.caixa_nome } : null,
      exigirAssinatura: Boolean(cfg?.exigir_assinatura),
      exigirPagamento: Boolean(cfg?.exigir_pagamento_entrega),
      pagamentos: (pags ?? []).map((p) => ({
        id: p.id,
        forma: p.forma,
        valor: Number(p.valor) || 0,
        vencimento: p.vencimento,
        sinal: p.sinal,
        created_at: p.created_at,
        cancelado_em: p.cancelado_em,
        cancelado_motivo: p.cancelado_motivo,
        podeEstornar: !p.cancelado_em && caixaPerm && loja && (gerente || (p.registrado_por === ctx.sessao.usuarioId && (!p.sessao_id || aberta.has(p.sessao_id)))),
      })),
    });
  });
}

export async function registrarPagamentoOs(
  empresaId: string,
  id: string,
  dados: { forma: string; valor: number; vencimento?: string; observacao?: string },
): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    const valor = Math.round((Number(dados.valor) || 0) * 100) / 100;
    if (valor <= 0) return falha("Informe o valor.");
    if (dados.forma === "a_receber" && !/^\d{4}-\d{2}-\d{2}$/.test(dados.vencimento ?? "")) return falha("Informe o vencimento combinado com o cliente.");
    const { error } = await ctx.supabase.rpc("os_pagamento_registrar", {
      p_ordem_id: id,
      p_dados: {
        forma: String(dados.forma ?? "").slice(0, 20),
        valor: valor.toFixed(2),
        vencimento: dados.forma === "a_receber" ? (dados.vencimento ?? "") : "",
        observacao: (dados.observacao ?? "").slice(0, 300),
      },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    revalidatePath(`/e/${empresaId}/loja`, "layout");
    return sucesso(dados.forma === "a_receber" ? "Valor deixado a receber (está em Contas a receber)." : "Recebimento registrado no caixa.");
  });
}

export async function estornarPagamentoOs(empresaId: string, pagamentoId: string, motivo: string): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(pagamentoId)) return falha("Recebimento inválido.");
    const ctx = await contexto(empresaId);
    const { error } = await ctx.supabase.rpc("os_pagamento_estornar", { p_pagamento_id: pagamentoId, p_motivo: String(motivo ?? "").slice(0, 300) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    revalidatePath(`/e/${empresaId}/loja`, "layout");
    return sucesso("Recebimento estornado.");
  });
}

// -----------------------------------------------------------------------------
// Entrega com nome, documento e assinatura de quem retira
// -----------------------------------------------------------------------------
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function entregarOs(
  empresaId: string,
  id: string,
  dados: { retirado_por: string; retirado_documento?: string; assinatura?: string | null },
): Promise<ResultadoAcao> {
  return executar(async () => {
    if (!UUID.test(id)) return falha("OS inválida.");
    const ctx = await contexto(empresaId);
    let caminho: string | null = null;
    const admin = criarClienteAdmin();
    if (dados.assinatura) {
      if (!assinaturaValida(dados.assinatura)) return falha("A assinatura não foi reconhecida. Assine de novo.");
      const bytes = Buffer.from(dados.assinatura.slice("data:image/png;base64,".length), "base64");
      if (bytes.length > 300_000 || !PNG.every((b, i) => bytes[i] === b)) return falha("A assinatura não foi reconhecida. Assine de novo.");
      // Confere a OS (e o acesso) antes de gravar o arquivo
      const { data: o } = await ctx.supabase.from("os_ordens").select("id").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
      if (!o) return falha("OS não encontrada.");
      caminho = `${empresaId}/${id}/assinatura-${randomUUID()}.png`;
      const { error: e1 } = await admin.storage.from("os-fotos").upload(caminho, bytes, { contentType: "image/png", upsert: false });
      if (e1) return falha("Não foi possível guardar a assinatura. Tente novamente.");
    }
    const { error } = await ctx.supabase.rpc("os_entregar", {
      p_id: id,
      p_dados: {
        retirado_por: String(dados.retirado_por ?? "").trim().slice(0, 120),
        retirado_documento: String(dados.retirado_documento ?? "").trim().slice(0, 30),
        assinatura_caminho: caminho ?? "",
      },
    });
    if (error) {
      if (caminho) await admin.storage.from("os-fotos").remove([caminho]);
      return falha(mensagemErro(error));
    }
    revalidar(empresaId);
    return sucesso("OS entregue.");
  });
}

// -----------------------------------------------------------------------------
// Setores e máquinas; aviso automático e regras da entrega (os.gerenciar)
// -----------------------------------------------------------------------------
export async function salvarSetorOs(empresaId: string, id: string | null, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    if (id && !UUID.test(id)) return falha("Setor inválido.");
    const ctx = await contexto(empresaId, true);
    const nome = texto(fd, "nome", 60);
    if (nome.length < 2) return falha("Revise os campos destacados.", { nome: ["Informe o nome do setor ou da máquina."] });
    const { error } = await ctx.supabase.rpc("os_setor_salvar", {
      p_empresa_id: empresaId,
      p_id: id as string,
      p_dados: { nome, maquinas: texto(fd, "maquinas", 3) || "1", ativo: fd.get("ativo") !== "off" },
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Setor atualizado." : "Setor cadastrado.");
  });
}

export async function configurarExtrasOs(empresaId: string, _a: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const token = String(fd.get("whatsapp_token") ?? "").trim();
    const removerToken = fd.get("remover_token") === "on";
    if (token && (token.length < 20 || token.length > 1000 || /\s/.test(token))) {
      return falha("Revise os campos destacados.", { whatsapp_token: ["Cole o token de acesso completo (sem espaços)."] });
    }
    const { error } = await ctx.supabase.rpc("os_configurar_extras", {
      p_empresa_id: empresaId,
      p_dados: {
        whatsapp_ativo: fd.get("whatsapp_ativo") === "on",
        whatsapp_phone_number_id: texto(fd, "whatsapp_phone_number_id", 40),
        whatsapp_modelo: texto(fd, "whatsapp_modelo", 512),
        whatsapp_idioma: texto(fd, "whatsapp_idioma", 10) || "pt_BR",
        exigir_assinatura: fd.get("exigir_assinatura") === "on",
        exigir_pagamento_entrega: fd.get("exigir_pagamento_entrega") === "on",
      },
    });
    if (error) return falha(mensagemErro(error));
    const admin = criarClienteAdmin();
    if (removerToken) {
      await admin.from("os_whatsapp_segredo").delete().eq("empresa_id", empresaId);
    } else if (token) {
      let cifrado: string;
      try {
        cifrado = cifrar(token);
      } catch (e) {
        if (e instanceof ErroChaveCertificados) return falha("O servidor ainda não tem a chave para guardar senhas e tokens (CERTIFICADOS_CHAVE). Peça ao escritório.");
        throw e;
      }
      const { error: e2 } = await admin
        .from("os_whatsapp_segredo")
        .upsert({ empresa_id: empresaId, token_cifrado: cifrado, atualizado_por: ctx.sessao.usuarioId, updated_at: new Date().toISOString() });
      if (e2) return falha("Não foi possível guardar o token. Tente novamente.");
    }
    revalidar(empresaId);
    return sucesso("Configuração salva.");
  });
}

/** Envia o modelo de "OS pronta" para um número de teste (mensagem real, pelo número da loja). */
export async function testarWhatsappOs(empresaId: string, telefone: string): Promise<ResultadoAcao> {
  return executar(async () => {
    const ctx = await contexto(empresaId, true);
    const numero = String(telefone ?? "").replace(/\D/g, "");
    if (numero.length < 10 || numero.length > 13) return falha("Informe o celular com DDD para o teste.");
    const admin = criarClienteAdmin();
    const [{ data: cfg }, { data: segredo }] = await Promise.all([
      admin.from("os_config").select("whatsapp_phone_number_id, whatsapp_modelo, whatsapp_idioma, nome_exibicao").eq("empresa_id", empresaId).maybeSingle(),
      admin.from("os_whatsapp_segredo").select("token_cifrado").eq("empresa_id", empresaId).maybeSingle(),
    ]);
    let token: string | null = null;
    if (segredo?.token_cifrado) {
      try {
        token = decifrar(segredo.token_cifrado);
      } catch {
        return falha("Não foi possível abrir o token guardado (a chave do servidor mudou?). Cole o token de novo.");
      }
    }
    const loja = cfg?.nome_exibicao ?? ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social;
    const r = await enviarModeloWhatsapp(
      { phoneNumberId: cfg?.whatsapp_phone_number_id ?? null, modelo: cfg?.whatsapp_modelo ?? null, idioma: cfg?.whatsapp_idioma ?? "pt_BR", token },
      numero,
      parametrosAvisoOs({ cliente: "Teste", numero: "0", loja, link: `${envPublico.siteUrl()}/acompanhar/teste` }),
    );
    if (r.enviado) return sucesso("Mensagem de teste enviada. Confira no celular.");
    if (r.motivo === "nao_configurado") return falha("O WhatsApp da loja ainda está desconectado: falta o Phone Number ID, o modelo ou o token.");
    return falha(`A Meta recusou o envio: ${r.erro ?? "erro desconhecido"}.`);
  });
}
