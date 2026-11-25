"use server";

import { revalidatePath } from "next/cache";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import type { Json } from "@/lib/supabase/database.types";

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

export async function previsaoOs(empresaId: string, minutos: number, prioridade: string): Promise<string | null> {
  try {
    const ctx = await contexto(empresaId);
    const { data } = await ctx.supabase.rpc("os_previsao", { p_empresa_id: empresaId, p_minutos: Math.max(Number(minutos) || 0, 0), p_prioridade: prioridade });
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
