"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { uuidOpcional, valorMonetario } from "@/lib/validacao";

/**
 * Ações do DRE personalizado e dos ajustes no resultado. Só quem pode editar
 * o financeiro da empresa; o banco confere de novo (RLS e funções).
 */
async function contextoEdicao(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.editar")) throw new Error("Você não tem permissão para editar o financeiro desta empresa.");
  return ctx;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/relatorios`, "layout");
  revalidatePath(`/e/${empresaId}/financeiro`, "layout");
}

async function executar(empresaId: string, fn: (ctx: Awaited<ReturnType<typeof contextoEdicao>>) => Promise<string>): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const mensagem = await fn(ctx);
    revalidar(empresaId);
    return sucesso(mensagem);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

async function linhaDaEmpresa(ctx: Awaited<ReturnType<typeof contextoEdicao>>, empresaId: string, id: string) {
  const { data } = await ctx.supabase.from("dre_modelo_linhas").select("id, chave_padrao, tipo").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
  if (!data) throw new Error("Linha não encontrada.");
  return data;
}

export async function personalizarDre(empresaId: string): Promise<ResultadoAcao> {
  return executar(empresaId, async (ctx) => {
    const { error } = await ctx.supabase.rpc("personalizar_dre", { p_empresa_id: empresaId });
    if (error) throw error;
    return "Pronto: agora o DRE segue o modelo da empresa. Comece renomeando, criando linhas ou mudando a ordem.";
  });
}

export async function restaurarDrePadrao(empresaId: string): Promise<ResultadoAcao> {
  return executar(empresaId, async (ctx) => {
    const { error } = await ctx.supabase.rpc("restaurar_dre_padrao", { p_empresa_id: empresaId });
    if (error) throw error;
    return "O DRE voltou ao modelo padrão.";
  });
}

const esquemaNovaLinha = z.object({
  tipo: z.enum(["grupo", "total"]),
  rotulo: z.string().trim().min(2, "Informe o nome da linha.").max(80, "Use até 80 letras."),
  depois_de: uuidOpcional,
});

export async function inserirLinhaDre(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const dados = esquemaNovaLinha.safeParse({ tipo: fd.get("tipo"), rotulo: String(fd.get("rotulo") ?? ""), depois_de: String(fd.get("depois_de") ?? "") });
  if (!dados.success) return falhaValidacao(dados.error);
  return executar(empresaId, async (ctx) => {
    if (dados.data.depois_de) await linhaDaEmpresa(ctx, empresaId, dados.data.depois_de);
    const { error } = await ctx.supabase.rpc("inserir_linha_dre", {
      p_empresa_id: empresaId,
      p_tipo: dados.data.tipo,
      p_rotulo: dados.data.rotulo,
      p_depois_de: dados.data.depois_de ?? undefined,
    });
    if (error) throw error;
    return dados.data.tipo === "total" ? "Subtotal criado." : "Linha criada. Agora traga as contas para ela.";
  });
}

const esquemaLinha = z.object({
  id: z.string().uuid(),
  rotulo: z.string().trim().min(2, "Informe o nome da linha.").max(80, "Use até 80 letras."),
});

export async function salvarLinhaDre(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const dados = esquemaLinha.safeParse({ id: fd.get("id"), rotulo: String(fd.get("rotulo") ?? "") });
  if (!dados.success) return falhaValidacao(dados.error);
  return executar(empresaId, async (ctx) => {
    const linha = await linhaDaEmpresa(ctx, empresaId, dados.data.id);
    const mudancas: { rotulo: string; mostrar_contas?: boolean; oculta?: boolean } = { rotulo: dados.data.rotulo };
    if (linha.tipo === "grupo") mudancas.mostrar_contas = fd.get("mostrar_contas") === "on";
    else if (linha.chave_padrao !== "resultado_liquido") mudancas.oculta = fd.get("mostrar_subtotal") !== "on";
    const { error } = await ctx.supabase.from("dre_modelo_linhas").update(mudancas).eq("id", linha.id).eq("empresa_id", empresaId);
    if (error) throw error;
    return "Linha atualizada.";
  });
}

export async function moverLinhaDre(empresaId: string, id: string, direcao: -1 | 1): Promise<ResultadoAcao> {
  return executar(empresaId, async (ctx) => {
    await linhaDaEmpresa(ctx, empresaId, id);
    const { error } = await ctx.supabase.rpc("mover_linha_dre", { p_linha_id: id, p_direcao: direcao });
    if (error) throw error;
    return "";
  });
}

export async function excluirLinhaDre(empresaId: string, id: string): Promise<ResultadoAcao> {
  return executar(empresaId, async (ctx) => {
    const linha = await linhaDaEmpresa(ctx, empresaId, id);
    if (linha.chave_padrao) throw new Error("Linhas do modelo padrão não são excluídas. Você pode renomear, mudar a ordem ou esconder.");
    const { error } = await ctx.supabase.from("dre_modelo_linhas").delete().eq("id", linha.id).eq("empresa_id", empresaId);
    if (error) throw error;
    return linha.tipo === "grupo" ? "Linha excluída. As contas dela voltaram para as linhas do padrão." : "Subtotal excluído.";
  });
}

/** Leva a conta (ou o grupo inteiro) para uma linha do DRE, ou devolve à linha do padrão (linhaId null). */
export async function definirLinhaConta(empresaId: string, categoriaId: string, linhaId: string | null): Promise<ResultadoAcao> {
  return executar(empresaId, async (ctx) => {
    if (linhaId) await linhaDaEmpresa(ctx, empresaId, linhaId);
    const { data, error } = await ctx.supabase
      .from("categorias_financeiras")
      .update({ dre_linha_id: linhaId })
      .eq("id", categoriaId)
      .eq("empresa_id", empresaId)
      .select("nome")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Conta não encontrada.");
    return linhaId ? `“${data.nome}” agora aparece nesta linha.` : `“${data.nome}” voltou para a linha do padrão.`;
  });
}

const esquemaAjuste = z.object({
  categoria_id: z.string().uuid("Escolha a conta."),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Informe o mês."),
  valor: valorMonetario({ obrigatorio: true, positivo: true }),
  sentido: z.enum(["aumenta", "diminui"]),
  motivo: z.string().trim().min(5, "Explique o motivo do ajuste (ex.: depreciação de novembro).").max(500, "Use até 500 letras."),
});

export async function lancarAjuste(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const dados = esquemaAjuste.safeParse({
    categoria_id: fd.get("categoria_id"),
    competencia: String(fd.get("competencia") ?? ""),
    valor: String(fd.get("valor") ?? ""),
    sentido: fd.get("sentido") ?? "aumenta",
    motivo: String(fd.get("motivo") ?? ""),
  });
  if (!dados.success) return falhaValidacao(dados.error);
  const { categoria_id, competencia, valor, sentido, motivo } = dados.data;
  return executar(empresaId, async (ctx) => {
    const { error } = await ctx.supabase.from("dre_ajustes").insert({
      empresa_id: empresaId,
      categoria_id,
      competencia: `${competencia}-01`,
      valor: Number(valor) * (sentido === "diminui" ? -1 : 1),
      motivo,
    });
    if (error) throw error;
    return "Ajuste lançado. Ele já aparece no DRE do mês.";
  });
}

export async function excluirAjuste(empresaId: string, id: string): Promise<ResultadoAcao> {
  return executar(empresaId, async (ctx) => {
    const { data, error } = await ctx.supabase.from("dre_ajustes").delete().eq("id", id).eq("empresa_id", empresaId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Ajuste não encontrado.");
    return "Ajuste excluído.";
  });
}
