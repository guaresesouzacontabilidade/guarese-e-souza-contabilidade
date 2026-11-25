"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { booleano, dataObrigatoria, textoOpcional, uuidOpcional, valorMonetario } from "@/lib/validacao";
import { somenteDigitos, validarCnpj, validarCpf } from "@/lib/formatos";

async function contextoEdicao(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.editar")) throw new Error("Você não tem permissão para editar o financeiro desta empresa.");
  return ctx;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/financeiro`, "layout");
  revalidatePath(`/escritorio/empresas/${empresaId}`);
}

// ------------------------------------------------------------ contas financeiras
const esquemaConta = z.object({
  id: uuidOpcional,
  tipo: z.enum(["conta_corrente", "poupanca", "investimento", "caixa", "cartao_credito", "adquirente", "outra"]),
  nome: z.string().trim().min(2, "Informe um nome para a conta."),
  banco_codigo: textoOpcional,
  banco_nome: textoOpcional,
  agencia: textoOpcional,
  numero: textoOpcional,
  saldo_inicial: valorMonetario({ obrigatorio: false }),
  saldo_inicial_data: dataObrigatoria("Informe a data de referência do saldo inicial."),
  cartao_dia_fechamento: z.coerce.number().int().min(1).max(31).nullable().optional(),
  cartao_dia_vencimento: z.coerce.number().int().min(1).max(31).nullable().optional(),
  cartao_conta_pagamento_id: uuidOpcional,
  limite: valorMonetario({ positivo: true, permitirZero: true }),
  compoe_saldo_disponivel: z.boolean(),
  ativa: z.boolean(),
  observacoes: textoOpcional,
});

export async function salvarConta(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const numeroOuNulo = (n: string) => (fd.get(n) ? String(fd.get(n)) : null);
    const dados = esquemaConta.safeParse({
      id: String(fd.get("id") ?? ""),
      tipo: fd.get("tipo"),
      nome: String(fd.get("nome") ?? ""),
      banco_codigo: String(fd.get("banco_codigo") ?? ""),
      banco_nome: String(fd.get("banco_nome") ?? ""),
      agencia: String(fd.get("agencia") ?? ""),
      numero: String(fd.get("numero") ?? ""),
      saldo_inicial: String(fd.get("saldo_inicial") ?? ""),
      saldo_inicial_data: String(fd.get("saldo_inicial_data") ?? ""),
      cartao_dia_fechamento: numeroOuNulo("cartao_dia_fechamento"),
      cartao_dia_vencimento: numeroOuNulo("cartao_dia_vencimento"),
      cartao_conta_pagamento_id: String(fd.get("cartao_conta_pagamento_id") ?? ""),
      limite: String(fd.get("limite") ?? ""),
      compoe_saldo_disponivel: booleano(fd, "compoe_saldo_disponivel"),
      ativa: fd.get("ativa") === null ? true : booleano(fd, "ativa"),
      observacoes: String(fd.get("observacoes") ?? ""),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const { id, ...c } = dados.data;
    const registro = {
      ...c,
      saldo_inicial: c.saldo_inicial ?? "0.00",
      limite: c.limite,
      cartao_dia_fechamento: c.tipo === "cartao_credito" ? c.cartao_dia_fechamento ?? null : null,
      cartao_dia_vencimento: c.tipo === "cartao_credito" ? c.cartao_dia_vencimento ?? null : null,
      cartao_conta_pagamento_id: c.tipo === "cartao_credito" ? c.cartao_conta_pagamento_id : null,
    } as never;
    const { error } = id
      ? await ctx.supabase.from("contas_financeiras").update(registro).eq("id", id).eq("empresa_id", empresaId)
      : await ctx.supabase.from("contas_financeiras").insert({ ...(registro as object), empresa_id: empresaId } as never);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(id ? "Conta atualizada." : "Conta cadastrada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------ categorias
const esquemaCategoria = z.object({
  id: uuidOpcional,
  codigo: z.string().trim().min(1, "Informe o código (ex.: 4.13)."),
  nome: z.string().trim().min(2, "Informe o nome."),
  tipo: z.enum([
    "receita_operacional", "deducao_receita", "custo_mercadoria", "custo_servico", "despesa_operacional",
    "receita_financeira", "despesa_financeira", "outras_receitas", "outras_despesas", "impostos_lucro",
    "investimento", "aporte_socio", "retirada_socio", "despesa_pessoal_socio", "emprestimo_captacao", "emprestimo_amortizacao",
  ]),
  pai_id: uuidOpcional,
  ativa: z.boolean(),
});

export async function salvarCategoria(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const grupo = fd.get("sintetica") === "true";
    const dados = esquemaCategoria.safeParse({
      id: String(fd.get("id") ?? ""),
      codigo: String(fd.get("codigo") ?? ""),
      nome: String(fd.get("nome") ?? ""),
      tipo: fd.get("tipo"),
      pai_id: grupo ? "" : String(fd.get("pai_id") ?? ""),
      ativa: fd.get("ativa") === null ? true : booleano(fd, "ativa"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const { id, ...c } = dados.data;
    const { error } = id
      ? await ctx.supabase.from("categorias_financeiras").update(c).eq("id", id).eq("empresa_id", empresaId)
      : await ctx.supabase.from("categorias_financeiras").insert({ ...c, empresa_id: empresaId, sintetica: grupo });
    if (error) {
      if (error.code === "23505") return falha("Já existe uma conta com esse código. Use outro código.", { codigo: ["Código já usado."] });
      return falha(mensagemErro(error));
    }
    revalidar(empresaId);
    revalidatePath(`/e/${empresaId}/relatorios`, "layout");
    return sucesso(grupo ? (id ? "Grupo atualizado." : "Grupo criado.") : id ? "Conta atualizada." : "Conta criada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export interface UsoConta {
  lancamentos: number;
  recorrencias: number;
  ajustes: number;
  meses_fechados: string[];
  contas_no_grupo: number;
  sistema: boolean;
  grupo: boolean;
}

/** Quanto a conta é usada (para a tela de exclusão). */
export async function usoCategoria(empresaId: string, id: string): Promise<ResultadoAcao<UsoConta>> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { data: cat } = await ctx.supabase.from("categorias_financeiras").select("id").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
    if (!cat) return falha("Conta não encontrada.");
    const { data, error } = await ctx.supabase.rpc("categoria_financeira_uso", { p_categoria_id: id });
    if (error) return falha(mensagemErro(error));
    return sucesso(undefined, data as unknown as UsoConta);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Exclui a conta (movendo lançamentos, recorrências e ajustes) ou o grupo (movendo as contas). */
export async function excluirCategoria(empresaId: string, id: string, destinoId: string | null): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { data: cat } = await ctx.supabase.from("categorias_financeiras").select("id, nome").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
    if (!cat) return falha("Conta não encontrada.");
    const { data, error } = await ctx.supabase.rpc("excluir_categoria_financeira", { p_categoria_id: id, p_destino_id: destinoId ?? undefined });
    if (error) return falha(mensagemErro(error));
    const r = data as { contas_movidas: number; lancamentos_movidos: number; recorrencias_movidas: number; ajustes_movidos: number };
    revalidar(empresaId);
    revalidatePath(`/e/${empresaId}/relatorios`, "layout");
    const movidos = r.lancamentos_movidos + r.recorrencias_movidas + r.ajustes_movidos;
    if (r.contas_movidas) return sucesso(`Grupo "${cat.nome}" excluído. ${r.contas_movidas} conta(s) mudaram de grupo.`);
    if (movidos) return sucesso(`Conta "${cat.nome}" excluída. ${movidos} lançamento(s) foram para a conta escolhida.`);
    return sucesso(`Conta "${cat.nome}" excluída.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Desativa a conta: some dos novos lançamentos, o histórico continua. */
export async function desativarCategoria(empresaId: string, id: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { error } = await ctx.supabase.from("categorias_financeiras").update({ ativa: false }).eq("id", id).eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conta desativada. Ela não aparece mais nos novos lançamentos; o histórico continua.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function aplicarPlanoPadrao(empresaId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const { data, error } = await ctx.supabase.rpc("configurar_empresa_padrao", { p_empresa_id: empresaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    const r = data as { categorias_criadas?: number } | null;
    return sucesso(`Plano padrão aplicado (${r?.categorias_criadas ?? 0} categoria(s) nova(s)).`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------ centros de custo e projetos
export async function salvarCentroCusto(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const nome = String(fd.get("nome") ?? "").trim();
    if (nome.length < 2) return falha("Informe o nome do centro de custo.", { nome: ["Informe o nome."] });
    const id = String(fd.get("id") ?? "");
    const registro = { nome, codigo: String(fd.get("codigo") ?? "").trim() || null, ativo: fd.get("ativo") === null ? true : booleano(fd, "ativo") };
    const { error } = id
      ? await ctx.supabase.from("centros_custo").update(registro).eq("id", id).eq("empresa_id", empresaId)
      : await ctx.supabase.from("centros_custo").insert({ ...registro, empresa_id: empresaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Centro de custo salvo.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function salvarProjeto(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const nome = String(fd.get("nome") ?? "").trim();
    if (nome.length < 2) return falha("Informe o nome do projeto.", { nome: ["Informe o nome."] });
    const id = String(fd.get("id") ?? "");
    const registro = {
      nome,
      codigo: String(fd.get("codigo") ?? "").trim() || null,
      inicio: String(fd.get("inicio") ?? "") || null,
      fim: String(fd.get("fim") ?? "") || null,
      ativo: fd.get("ativo") === null ? true : booleano(fd, "ativo"),
    };
    const { error } = id
      ? await ctx.supabase.from("projetos").update(registro).eq("id", id).eq("empresa_id", empresaId)
      : await ctx.supabase.from("projetos").insert({ ...registro, empresa_id: empresaId });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Projeto salvo.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------ contrapartes
const esquemaContraparte = z
  .object({
    id: uuidOpcional,
    nome: z.string().trim().min(2, "Informe o nome."),
    documento: textoOpcional,
    papeis: z.array(z.enum(["cliente", "fornecedor", "socio", "funcionario", "banco", "governo", "outro"])).min(1, "Selecione ao menos um papel."),
    email: textoOpcional,
    telefone: textoOpcional,
    observacoes: textoOpcional,
    ativo: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (!d.documento) return;
    const dig = somenteDigitos(d.documento);
    if (!((dig.length === 14 && validarCnpj(dig)) || (dig.length === 11 && validarCpf(dig)))) {
      ctx.addIssue({ code: "custom", path: ["documento"], message: "CPF/CNPJ inválido." });
    }
  });

export async function salvarContraparte(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id: string }>> {
  try {
    const ctx = await contextoEdicao(empresaId);
    const dados = esquemaContraparte.safeParse({
      id: String(fd.get("id") ?? ""),
      nome: String(fd.get("nome") ?? ""),
      documento: String(fd.get("documento") ?? ""),
      papeis: fd.getAll("papeis").map(String),
      email: String(fd.get("email") ?? ""),
      telefone: String(fd.get("telefone") ?? ""),
      observacoes: String(fd.get("observacoes") ?? ""),
      ativo: fd.get("ativo") === null ? true : booleano(fd, "ativo"),
    });
    if (!dados.success) return falhaValidacao(dados.error);
    const { id, ...c } = dados.data;
    const doc = c.documento ? somenteDigitos(c.documento) : null;
    const registro = { ...c, documento: doc, tipo_pessoa: doc ? (doc.length === 14 ? "PJ" : "PF") : null };
    const r = id
      ? await ctx.supabase.from("contrapartes").update(registro).eq("id", id).eq("empresa_id", empresaId).select("id").single()
      : await ctx.supabase.from("contrapartes").insert({ ...registro, empresa_id: empresaId }).select("id").single();
    if (r.error) return falha(r.error.code === "23505" ? "Já existe um cadastro com este CPF/CNPJ." : mensagemErro(r.error));
    revalidar(empresaId);
    return sucesso(id ? "Cadastro atualizado." : "Cadastro criado.", { id: r.data.id });
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
