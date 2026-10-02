"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, falhaValidacao, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { buscarTudo } from "@/lib/supabase/paginar";
import { termoBusca } from "@/lib/busca";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { diasEntre, somarDias } from "@/lib/competencia";
import { dataObrigatoria, dataOpcional, textoOpcional, uuidOpcional, valorMonetario } from "@/lib/validacao";
import { gerarSugestoes } from "./motor";
import { similaridade } from "./sugestoes";
import { TRATAMENTOS, type CandidatosConciliacao, type LancamentoCandidato } from "./tipos";

const UUID = /^[0-9a-f-]{36}$/i;
const listaIds = (max: number) => z.array(z.string().regex(UUID, "Seleção inválida.")).max(max, "Seleção grande demais.");

async function contextoConciliacao(empresaId: string) {
  if (!UUID.test(empresaId)) throw new Error("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("conciliacao.executar")) throw new Error("Você não tem permissão para conciliar o financeiro desta empresa.");
  return ctx;
}

function revalidar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/conciliacao`);
  revalidatePath(`/e/${empresaId}/financeiro`, "layout");
  revalidatePath("/escritorio/conciliacao");
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

// ------------------------------------------------------------------ sugestões
/** Executa agora o motor de correspondência (também roda após cada importação). */
export async function buscarSugestoes(empresaId: string): Promise<ResultadoAcao> {
  try {
    await contextoConciliacao(empresaId);
    const r = await gerarSugestoes(criarClienteAdmin(), empresaId);
    revalidar(empresaId);
    if (!r.analisadas) return sucesso("Nenhuma movimentação pendente fora das sugestões já abertas.");
    return sucesso(
      r.sugestoes
        ? `${plural(r.sugestoes, "nova sugestão encontrada", "novas sugestões encontradas")} em ${plural(r.analisadas, "movimentação analisada", "movimentações analisadas")}.`
        : `Nenhuma nova correspondência nas ${plural(r.analisadas, "movimentação pendente", "movimentações pendentes")}. Use “Conciliar” ou “Classificar” em cada uma.`,
    );
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

const esquemaConfirmacao = z.object({
  tratamento: z.enum(TRATAMENTOS).nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  conta_contrapartida: z.string().regex(UUID).nullable().optional(),
});

export async function confirmarSugestao(
  empresaId: string,
  conciliacaoId: string,
  opcoes: z.input<typeof esquemaConfirmacao> = {},
): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    if (!UUID.test(conciliacaoId)) return falha("Sugestão inválida.");
    const o = esquemaConfirmacao.safeParse(opcoes);
    if (!o.success) return falhaValidacao(o.error);
    const { data: c } = await ctx.supabase.from("conciliacoes").select("id").eq("id", conciliacaoId).eq("empresa_id", empresaId).maybeSingle();
    if (!c) return falha("Sugestão não encontrada. Ela pode ter sido confirmada ou removida por outra pessoa.");
    const { error } = await ctx.supabase.rpc("confirmar_conciliacao", {
      p_conciliacao_id: conciliacaoId,
      p_tratamento: o.data.tratamento ?? undefined,
      p_observacao: o.data.observacao || undefined,
      p_conta_contrapartida: o.data.conta_contrapartida ?? undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conciliação confirmada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Confirma várias sugestões sem diferença de valor (as demais ficam para revisão individual). */
export async function confirmarSugestoesEmLote(empresaId: string, conciliacaoIds: string[]): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    const ids = listaIds(200).min(1, "Selecione ao menos uma sugestão.").safeParse(conciliacaoIds);
    if (!ids.success) return falhaValidacao(ids.error);
    let confirmadas = 0;
    const falhas: string[] = [];
    for (const id of ids.data) {
      const { error } = await ctx.supabase.rpc("confirmar_conciliacao", { p_conciliacao_id: id });
      if (error) falhas.push(mensagemErro(error));
      else confirmadas++;
    }
    revalidar(empresaId);
    if (!falhas.length) return sucesso(`${plural(confirmadas, "conciliação confirmada", "conciliações confirmadas")}.`);
    if (!confirmadas) return falha(`Nenhuma sugestão foi confirmada. ${falhas[0]}`);
    return sucesso(
      `${plural(confirmadas, "conciliação confirmada", "conciliações confirmadas")}; ${plural(falhas.length, "sugestão precisa", "sugestões precisam")} de revisão individual (${falhas[0]}).`,
    );
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function rejeitarSugestao(empresaId: string, conciliacaoId: string, motivo?: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    if (!UUID.test(conciliacaoId)) return falha("Sugestão inválida.");
    const { data: c } = await ctx.supabase.from("conciliacoes").select("id").eq("id", conciliacaoId).eq("empresa_id", empresaId).maybeSingle();
    if (!c) return falha("Sugestão não encontrada.");
    const { error } = await ctx.supabase.rpc("rejeitar_sugestao_conciliacao", {
      p_conciliacao_id: conciliacaoId,
      p_motivo: motivo?.trim().slice(0, 500) || undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Sugestão rejeitada. Este par não será sugerido novamente.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ conciliação manual
const esquemaManual = z.object({
  movimentos: listaIds(50).min(1, "Selecione ao menos uma movimentação."),
  lancamentos: listaIds(50).default([]),
  baixas: listaIds(50).default([]),
  transferencias: listaIds(10).default([]),
  tipo: z.enum(["lancamento", "transferencia"]).default("lancamento"),
  tratamento: z.enum(TRATAMENTOS).nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
  conta_contrapartida: z.string().regex(UUID).nullable().optional(),
});

export async function conciliarManual(empresaId: string, dados: z.input<typeof esquemaManual>): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    const d = esquemaManual.safeParse(dados);
    if (!d.success) return falhaValidacao(d.error);
    const v = d.data;
    if (v.tipo === "lancamento" && !v.lancamentos.length && !v.baixas.length && !v.transferencias.length) {
      return falha("Selecione o lançamento, o pagamento ou a transferência correspondente.");
    }
    const { error } = await ctx.supabase.rpc("conciliar_manual", {
      p_empresa_id: empresaId,
      p_movimentos: v.movimentos,
      p_lancamentos: v.lancamentos,
      p_baixas: v.baixas,
      p_transferencias: v.transferencias,
      p_tipo: v.tipo,
      p_tratamento: v.tratamento ?? undefined,
      p_observacao: v.observacao || undefined,
      p_conta_contrapartida: v.conta_contrapartida ?? undefined,
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(v.tipo === "transferencia" ? "Transferência conciliada." : "Conciliação registrada.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

/** Opções para conciliar manualmente as movimentações selecionadas. */
export async function carregarCandidatos(
  empresaId: string,
  movimentoIds: string[],
  busca?: string,
): Promise<ResultadoAcao<CandidatosConciliacao>> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    const ids = listaIds(50).min(1, "Selecione ao menos uma movimentação.").safeParse(movimentoIds);
    if (!ids.success) return falhaValidacao(ids.error);

    const [{ data: movs }, { data: contas }] = await Promise.all([
      ctx.supabase
        .from("movimentos_bancarios")
        .select("id, data, valor, descricao, conta_financeira_id, status_conciliacao")
        .eq("empresa_id", empresaId)
        .in("id", ids.data)
        .order("data"),
      ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ]);
    if (!movs || movs.length !== ids.data.length) return falha("Movimentação não encontrada.");
    if (movs.some((m) => m.status_conciliacao !== "pendente")) return falha("Uma das movimentações já foi conciliada ou ignorada. Atualize a página.");
    const nomeConta = new Map((contas ?? []).map((c) => [c.id, c.nome]));
    const conta = movs[0].conta_financeira_id;
    const positivo = dec(movs[0].valor).isPositive();
    const tipo: "receber" | "pagar" = positivo ? "receber" : "pagar";
    const movimentos = movs.map((m) => ({
      id: m.id,
      data: m.data,
      valor: dec(m.valor).toFixed(2),
      descricao: m.descricao,
      conta_id: m.conta_financeira_id,
      conta_nome: nomeConta.get(m.conta_financeira_id) ?? "Conta",
    }));
    const base: CandidatosConciliacao = {
      tipo,
      conta_id: conta,
      movimentos,
      lancamentos: [],
      lancamentos_sugeridos: 0,
      baixas: [],
      transferencias: [],
      outras_contas_movimentos: [],
      contas: (contas ?? []).filter((c) => c.id !== conta),
    };
    // Duas movimentações de contas diferentes: só podem ser uma transferência entre elas.
    const mesmaConta = movs.every((m) => m.conta_financeira_id === conta);
    if (!mesmaConta) return sucesso(undefined, base);
    if (movs.some((m) => dec(m.valor).isPositive() !== positivo)) return falha("Não misture entradas e saídas na mesma conciliação.");

    const total = movs.reduce((s, m) => s.plus(dec(m.valor).abs()), dec(0));
    const dataRef = movs[0].data;
    const termo = termoBusca(busca);

    // Lançamentos em aberto (confirmados) do mesmo sentido
    const consultaLanc = (de: number, ate: number) => {
      let q = ctx.supabase
        .from("lancamentos")
        .select("id, descricao, data_vencimento, valor_previsto, valor_baixado, numero_documento, situacao, contraparte:contrapartes(nome)")
        .eq("empresa_id", empresaId)
        .eq("tipo", tipo)
        .eq("status_revisao", "confirmado")
        .in("situacao", ["aberto", "parcial"]);
      if (termo) q = q.or(`descricao.ilike.%${termo}%,numero_documento.ilike.%${termo}%`);
      return q.order("data_vencimento").order("id").range(de, ate);
    };
    const [lancs, sugeridos, baixas, transfs] = await Promise.all([
      buscarTudo(consultaLanc, termo ? 500 : 5000),
      ctx.supabase
        .from("lancamentos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .eq("tipo", tipo)
        .eq("status_revisao", "sugerido")
        .in("situacao", ["aberto", "parcial"]),
      ctx.supabase
        .from("baixas")
        .select("id, data_pagamento, valor_total, lancamento:lancamentos(descricao)")
        .eq("empresa_id", empresaId)
        .eq("conta_financeira_id", conta)
        .eq("tipo", tipo)
        .gte("data_pagamento", somarDias(dataRef, -60))
        .lte("data_pagamento", somarDias(dataRef, 60))
        .order("data_pagamento")
        .limit(300),
      ctx.supabase
        .from("transferencias")
        .select("id, data, valor, descricao, conta_origem_id, conta_destino_id")
        .eq("empresa_id", empresaId)
        .eq(positivo ? "conta_destino_id" : "conta_origem_id", conta)
        .gte("data", somarDias(dataRef, -30))
        .lte("data", somarDias(dataRef, 30))
        .order("data")
        .limit(100),
    ]);

    const alvo = total.toNumber();
    const pontuar = (l: (typeof lancs)[number]) => {
      const aberto = dec(l.valor_previsto).minus(dec(l.valor_baixado)).toNumber();
      const difValor = Math.abs(aberto - alvo) / Math.max(alvo, 1);
      const difDias = Math.abs(diasEntre(l.data_vencimento, dataRef));
      const nome = (l.contraparte as { nome: string } | null)?.nome ?? "";
      const sim = movs.length === 1 ? similaridade(movs[0].descricao, `${l.descricao} ${nome}`) : 0;
      return (aberto === alvo ? 0 : 1 + Math.min(difValor, 5)) + Math.min(difDias, 120) / 60 - sim;
    };
    const lancamentos: LancamentoCandidato[] = lancs
      .map((l) => ({ l, p: pontuar(l) }))
      .sort((a, b) => a.p - b.p)
      .slice(0, 150)
      .map(({ l }) => ({
        id: l.id,
        descricao: l.descricao,
        contraparte: (l.contraparte as { nome: string } | null)?.nome ?? null,
        vencimento: l.data_vencimento,
        previsto: dec(l.valor_previsto).toFixed(2),
        aberto: dec(l.valor_previsto).minus(dec(l.valor_baixado)).toFixed(2),
        numero_documento: l.numero_documento,
        parcial: l.situacao === "parcial",
      }));

    // Baixas e transferências que ainda não estão conciliadas nesta conta
    const baixaIds = (baixas.data ?? []).map((b) => b.id);
    const transfIds = (transfs.data ?? []).map((t) => t.id);
    const [itensBaixa, itensTransf] = await Promise.all([
      baixaIds.length
        ? ctx.supabase.from("conciliacao_itens").select("baixa_id").in("baixa_id", baixaIds).eq("ativo", true)
        : Promise.resolve({ data: [] as { baixa_id: string | null }[] }),
      transfIds.length
        ? ctx.supabase.from("conciliacao_itens").select("transferencia_id, conciliacao_id").in("transferencia_id", transfIds).eq("ativo", true)
        : Promise.resolve({ data: [] as { transferencia_id: string | null; conciliacao_id: string }[] }),
    ]);
    const baixasConciliadas = new Set((itensBaixa.data ?? []).map((i) => i.baixa_id));
    const conciliacoesTransf = [...new Set((itensTransf.data ?? []).map((i) => i.conciliacao_id))];
    const ladoUsado = new Set<string>();
    if (conciliacoesTransf.length) {
      const { data: movItens } = await ctx.supabase
        .from("conciliacao_itens")
        .select("conciliacao_id, movimento:movimentos_bancarios(conta_financeira_id)")
        .in("conciliacao_id", conciliacoesTransf)
        .eq("ativo", true)
        .not("movimento_id", "is", null);
      const contasPorConc = new Map<string, Set<string>>();
      for (const i of movItens ?? []) {
        const c = (i.movimento as { conta_financeira_id: string } | null)?.conta_financeira_id;
        if (!c) continue;
        if (!contasPorConc.has(i.conciliacao_id)) contasPorConc.set(i.conciliacao_id, new Set());
        contasPorConc.get(i.conciliacao_id)!.add(c);
      }
      for (const i of itensTransf.data ?? []) {
        if (i.transferencia_id && contasPorConc.get(i.conciliacao_id)?.has(conta)) ladoUsado.add(i.transferencia_id);
      }
    }

    base.lancamentos = lancamentos;
    base.lancamentos_sugeridos = sugeridos.count ?? 0;
    base.baixas = (baixas.data ?? [])
      .filter((b) => !baixasConciliadas.has(b.id) && b.valor_total !== null)
      .map((b) => ({
        id: b.id,
        data: b.data_pagamento,
        total: dec(b.valor_total).toFixed(2),
        descricao: (b.lancamento as { descricao: string } | null)?.descricao ?? "Pagamento registrado",
      }));
    base.transferencias = (transfs.data ?? [])
      .filter((t) => !ladoUsado.has(t.id))
      .map((t) => ({
        id: t.id,
        data: t.data,
        valor: dec(t.valor).toFixed(2),
        descricao: t.descricao ?? "Transferência",
        origem: nomeConta.get(t.conta_origem_id) ?? "Conta",
        destino: nomeConta.get(t.conta_destino_id) ?? "Conta",
      }));

    // Movimentação do outro lado (outra conta, valor oposto, datas próximas)
    if (movs.length === 1) {
      const { data: outras } = await ctx.supabase
        .from("movimentos_bancarios")
        .select("id, data, valor, descricao, conta_financeira_id")
        .eq("empresa_id", empresaId)
        .eq("status_conciliacao", "pendente")
        .neq("conta_financeira_id", conta)
        .eq("valor", dec(movs[0].valor).negated().toNumber())
        .gte("data", somarDias(dataRef, -5))
        .lte("data", somarDias(dataRef, 5))
        .order("data")
        .limit(20);
      base.outras_contas_movimentos = (outras ?? []).map((m) => ({
        id: m.id,
        data: m.data,
        valor: dec(m.valor).toFixed(2),
        descricao: m.descricao,
        conta_id: m.conta_financeira_id,
        conta_nome: nomeConta.get(m.conta_financeira_id) ?? "Conta",
      }));
    }
    return sucesso(undefined, base);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ classificar
const esquemaClassificar = z.object({
  movimento_id: z.string().regex(UUID, "Movimentação inválida."),
  categoria_id: z.string().regex(UUID, "Selecione a categoria."),
  descricao: textoOpcional,
  contraparte_id: uuidOpcional,
  centro_custo_id: uuidOpcional,
  data_competencia: dataOpcional,
  documento_id: uuidOpcional,
});

/** Cria o lançamento já pago a partir de uma movimentação sem correspondência e concilia. */
export async function classificarMovimento(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    if (!ctx.pode("financeiro.editar")) return falha("Você não tem permissão para criar lançamentos nesta empresa.");
    const texto = (n: string) => String(fd.get(n) ?? "");
    const d = esquemaClassificar.safeParse({
      movimento_id: texto("movimento_id"),
      categoria_id: texto("categoria_id"),
      descricao: texto("descricao"),
      contraparte_id: texto("contraparte_id"),
      centro_custo_id: texto("centro_custo_id"),
      data_competencia: texto("data_competencia"),
      documento_id: texto("documento_id"),
    });
    if (!d.success) return falhaValidacao(d.error);
    const v = d.data;
    const { data: mov } = await ctx.supabase.from("movimentos_bancarios").select("id, valor").eq("id", v.movimento_id).eq("empresa_id", empresaId).maybeSingle();
    if (!mov) return falha("Movimentação não encontrada.");
    const { data: cat } = await ctx.supabase.from("categorias_financeiras").select("natureza").eq("id", v.categoria_id).eq("empresa_id", empresaId).maybeSingle();
    if (!cat) return falha("Categoria inválida.", { categoria_id: ["Selecione a categoria."] });
    const entrada = dec(mov.valor).isPositive();
    if ((entrada && cat.natureza !== "receita") || (!entrada && cat.natureza !== "despesa")) {
      return falha("A categoria não combina com a movimentação.", {
        categoria_id: [entrada ? "Para uma entrada, escolha uma categoria de receita." : "Para uma saída, escolha uma categoria de despesa."],
      });
    }
    const { error } = await ctx.supabase.rpc("classificar_movimento", {
      p_movimento_id: v.movimento_id,
      p_categoria_id: v.categoria_id,
      p_descricao: v.descricao ?? undefined,
      p_contraparte_id: v.contraparte_id ?? undefined,
      p_centro_custo_id: v.centro_custo_id ?? undefined,
      p_data_competencia: v.data_competencia ?? undefined,
      p_documento_ids: v.documento_id ? [v.documento_id] : [],
    });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Movimentação classificada: lançamento criado e conciliado.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ ignorar / reativar
export async function ignorarMovimentos(empresaId: string, movimentoIds: string[], motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    const ids = listaIds(200).min(1, "Selecione ao menos uma movimentação.").safeParse(movimentoIds);
    if (!ids.success) return falhaValidacao(ids.error);
    const m = (motivo ?? "").trim();
    if (m.length < 3) return falha("Informe por que a movimentação será ignorada.");
    let ok = 0;
    let erro = "";
    for (const id of ids.data) {
      const { error } = await ctx.supabase.rpc("ignorar_movimento", { p_movimento_id: id, p_ignorar: true, p_motivo: m.slice(0, 500) });
      if (error) erro ||= mensagemErro(error);
      else ok++;
    }
    revalidar(empresaId);
    if (!ok) return falha(erro || "Nenhuma movimentação foi ignorada.");
    return sucesso(`${plural(ok, "movimentação ignorada", "movimentações ignoradas")}${erro ? ` (algumas não puderam ser ignoradas: ${erro})` : ""}.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function reativarMovimento(empresaId: string, movimentoId: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    if (!UUID.test(movimentoId)) return falha("Movimentação inválida.");
    const { error } = await ctx.supabase.rpc("ignorar_movimento", { p_movimento_id: movimentoId, p_ignorar: false });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Movimentação voltou para as pendentes.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ desfazer
export async function desfazerConciliacao(empresaId: string, conciliacaoId: string, motivo: string): Promise<ResultadoAcao> {
  try {
    const ctx = await contextoConciliacao(empresaId);
    if (!UUID.test(conciliacaoId)) return falha("Conciliação inválida.");
    const m = (motivo ?? "").trim();
    if (m.length < 3) return falha("Informe o motivo para desfazer a conciliação.");
    const { data: c } = await ctx.supabase.from("conciliacoes").select("id").eq("id", conciliacaoId).eq("empresa_id", empresaId).maybeSingle();
    if (!c) return falha("Conciliação não encontrada.");
    const { error } = await ctx.supabase.rpc("desfazer_conciliacao", { p_conciliacao_id: conciliacaoId, p_motivo: m.slice(0, 500) });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso("Conciliação desfeita. As movimentações voltaram para as pendentes.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

// ------------------------------------------------------------------ saldo do extrato
const esquemaSaldo = z.object({
  conta_financeira_id: z.string().regex(UUID, "Selecione a conta."),
  data: dataObrigatoria("Informe a data do saldo."),
  saldo: valorMonetario({ obrigatorio: true }),
});

/** Informa o saldo final mostrado no extrato do banco (para a conferência de saldos). */
export async function informarSaldoExtrato(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  try {
    if (!UUID.test(empresaId)) return falha("Empresa inválida.");
    const ctx = await obterContextoEmpresa(empresaId);
    if (!ctx.pode("financeiro.editar")) return falha("Você não tem permissão para editar o financeiro desta empresa.");
    const d = esquemaSaldo.safeParse({
      conta_financeira_id: String(fd.get("conta_financeira_id") ?? ""),
      data: String(fd.get("data") ?? ""),
      saldo: String(fd.get("saldo") ?? ""),
    });
    if (!d.success) return falhaValidacao(d.error);
    const v = d.data;
    const { data: conta } = await ctx.supabase.from("contas_financeiras").select("id").eq("id", v.conta_financeira_id).eq("empresa_id", empresaId).maybeSingle();
    if (!conta) return falha("Conta não encontrada.", { conta_financeira_id: ["Selecione a conta."] });
    // Um saldo manual por conta e data: substitui o anterior.
    await ctx.supabase.from("extrato_saldos").delete().eq("empresa_id", empresaId).eq("conta_financeira_id", v.conta_financeira_id).eq("data", v.data).eq("fonte", "manual");
    const { error } = await ctx.supabase
      .from("extrato_saldos")
      .insert({ empresa_id: empresaId, conta_financeira_id: v.conta_financeira_id, data: v.data, saldo: Number(v.saldo), fonte: "manual" });
    if (error) return falha(mensagemErro(error));
    revalidar(empresaId);
    return sucesso(`Saldo do extrato de ${formatarMoeda(v.saldo)} registrado.`);
  } catch (e) {
    return falha(mensagemErro(e));
  }
}

export async function excluirSaldoExtrato(empresaId: string, saldoId: string): Promise<ResultadoAcao> {
  try {
    if (!UUID.test(empresaId) || !UUID.test(saldoId)) return falha("Registro inválido.");
    const ctx = await obterContextoEmpresa(empresaId);
    if (!ctx.pode("financeiro.editar")) return falha("Você não tem permissão para editar o financeiro desta empresa.");
    const { error, count } = await ctx.supabase
      .from("extrato_saldos")
      .delete({ count: "exact" })
      .eq("id", saldoId)
      .eq("empresa_id", empresaId)
      .eq("fonte", "manual");
    if (error) return falha(mensagemErro(error));
    if (!count) return falha("Somente saldos informados manualmente podem ser excluídos.");
    revalidar(empresaId);
    return sucesso("Saldo excluído.");
  } catch (e) {
    return falha(mensagemErro(e));
  }
}
