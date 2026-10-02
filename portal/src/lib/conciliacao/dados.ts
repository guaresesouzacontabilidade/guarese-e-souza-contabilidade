import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { buscarTudo } from "@/lib/supabase/paginar";
import { somarDias } from "@/lib/competencia";
import { dec } from "@/lib/dinheiro";
import type { BaixaLivre, CategoriaOpcao, LancamentoAberto, MovimentoTela, Opcao, SugestaoTela, TransferenciaLivre } from "@/components/conciliacao/tipos";

type Cliente = ContextoEmpresa["supabase"];
type Nome = { nome: string } | null;

/** Executa uma consulta `.in(...)` em lotes (URLs do PostgREST têm limite de tamanho). */
async function emLotes<T>(ids: string[], consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const unicos = [...new Set(ids)];
  const saida: T[] = [];
  for (let i = 0; i < unicos.length; i += 200) {
    const { data, error } = await consulta(unicos.slice(i, i + 200));
    if (error) throw new Error(error.message);
    saida.push(...(data ?? []));
  }
  return saida;
}

const CAMPOS_LANC = "id, tipo, descricao, valor_previsto, valor_baixado, data_vencimento, numero_documento, situacao, status_revisao, contraparte:contrapartes(nome)";
const CAMPOS_MOV = "id, conta_financeira_id, data, valor, descricao, documento_contraparte, status_conciliacao, ignorado_motivo";

interface LancRow {
  id: string;
  tipo: string;
  descricao: string;
  valor_previsto: number;
  valor_baixado: number;
  data_vencimento: string;
  numero_documento: string | null;
  situacao: string;
  status_revisao: string;
  contraparte: unknown;
}

function paraLancamento(l: LancRow): LancamentoAberto {
  return {
    id: l.id,
    tipo: l.tipo as LancamentoAberto["tipo"],
    descricao: l.descricao,
    aberto: dec(l.valor_previsto).minus(dec(l.valor_baixado)).toFixed(2),
    vencimento: l.data_vencimento,
    contraparte: (l.contraparte as Nome)?.nome ?? null,
    numero: l.numero_documento,
  };
}

export interface FiltroConciliacao {
  contaId: string | null;
  inicio: string;
  fim: string;
}

export async function carregarConciliacao(supabase: Cliente, empresaId: string, f: FiltroConciliacao, contas: { id: string; nome: string }[]) {
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const comConta = <Q extends { eq: (c: string, v: string) => Q }>(q: Q, coluna = "conta_financeira_id") => (f.contaId ? q.eq(coluna, f.contaId) : q);

  const [movimentos, sugestoesBrutas, foraPeriodo, lancamentos, baixas, transferencias, categorias, contrapartes, saldos] = await Promise.all([
    buscarTudo(
      (de, ate) =>
        comConta(supabase.from("movimentos_bancarios").select(CAMPOS_MOV).eq("empresa_id", empresaId))
          .gte("data", f.inicio)
          .lte("data", f.fim)
          .order("data")
          .order("id")
          .range(de, ate),
      10_000,
    ),
    buscarTudo(
      (de, ate) =>
        supabase
          .from("conciliacoes")
          .select("id, tipo, pontuacao, observacao, criterios, conciliacao_itens(movimento_id, lancamento_id, baixa_id, transferencia_id, valor)")
          .eq("empresa_id", empresaId)
          .eq("status", "sugerida")
          .order("pontuacao", { ascending: false })
          .order("id")
          .range(de, ate),
      5_000,
    ),
    comConta(supabase.from("movimentos_bancarios").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId))
      .eq("status_conciliacao", "pendente")
      .or(`data.lt.${f.inicio},data.gt.${f.fim}`),
    buscarTudo(
      (de, ate) =>
        supabase
          .from("lancamentos")
          .select(CAMPOS_LANC)
          .eq("empresa_id", empresaId)
          .eq("status_revisao", "confirmado")
          .in("situacao", ["aberto", "parcial"])
          .order("data_vencimento")
          .order("id")
          .range(de, ate),
      5_000,
    ),
    buscarTudo(
      (de, ate) =>
        supabase
          .from("baixas")
          .select("id, tipo, valor_total, data_pagamento, conta_financeira_id, lancamento:lancamentos(descricao, contraparte:contrapartes(nome))")
          .eq("empresa_id", empresaId)
          .gte("data_pagamento", somarDias(f.inicio, -60))
          .lte("data_pagamento", somarDias(f.fim, 15))
          .order("data_pagamento")
          .order("id")
          .range(de, ate),
      5_000,
    ),
    buscarTudo(
      (de, ate) =>
        supabase
          .from("transferencias")
          .select("id, data, valor, descricao, conta_origem_id, conta_destino_id")
          .eq("empresa_id", empresaId)
          .gte("data", somarDias(f.inicio, -15))
          .lte("data", somarDias(f.fim, 15))
          .order("data")
          .order("id")
          .range(de, ate),
      5_000,
    ),
    supabase.from("categorias_financeiras").select("id, codigo, nome, natureza, sintetica").eq("empresa_id", empresaId).eq("ativa", true).order("codigo"),
    supabase.from("contrapartes").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome").limit(1000),
    supabase.rpc("conferencia_saldos", { p_empresa_id: empresaId, p_inicio: f.inicio, p_fim: f.fim }),
  ]);

  // Baixas já conciliadas não são candidatas.
  const baixasAtivas = new Set(
    (
      await emLotes(
        baixas.map((b) => b.id),
        (lote) => supabase.from("conciliacao_itens").select("baixa_id").eq("ativo", true).in("baixa_id", lote),
      )
    ).map((i) => i.baixa_id),
  );

  // Lado de cada transferência que já foi conciliado (conta da movimentação conciliada).
  const itensTransf = await emLotes(
    transferencias.map((t) => t.id),
    (lote) => supabase.from("conciliacao_itens").select("transferencia_id, conciliacao_id").eq("ativo", true).in("transferencia_id", lote),
  );
  const contasConciliadasPorConc = new Map<string, Set<string>>();
  for (const i of await emLotes(
    itensTransf.map((i) => i.conciliacao_id),
    (lote) => supabase.from("conciliacao_itens").select("conciliacao_id, movimento:movimentos_bancarios(conta_financeira_id)").in("conciliacao_id", lote).not("movimento_id", "is", null),
  )) {
    const conta = (i.movimento as { conta_financeira_id: string } | null)?.conta_financeira_id;
    if (!conta) continue;
    const s = contasConciliadasPorConc.get(i.conciliacao_id) ?? new Set<string>();
    s.add(conta);
    contasConciliadasPorConc.set(i.conciliacao_id, s);
  }
  const ladosConciliados = new Map<string, Set<string>>();
  for (const i of itensTransf) {
    if (!i.transferencia_id) continue;
    const s = ladosConciliados.get(i.transferencia_id) ?? new Set<string>();
    for (const c of contasConciliadasPorConc.get(i.conciliacao_id) ?? []) s.add(c);
    ladosConciliados.set(i.transferencia_id, s);
  }

  // Conciliações ativas das movimentações conciliadas (para desfazer).
  const conciliadas = movimentos.filter((m) => m.status_conciliacao === "conciliado").map((m) => m.id);
  const conciliacaoPorMov = new Map<string, { id: string; tipo: string | null; em: string | null }>();
  for (const i of await emLotes(
    conciliadas,
    (lote) => supabase.from("conciliacao_itens").select("movimento_id, conciliacao_id, conciliacao:conciliacoes(tipo, confirmada_em)").eq("ativo", true).in("movimento_id", lote),
  )) {
    const c = i.conciliacao as { tipo: string; confirmada_em: string | null } | null;
    if (i.movimento_id) conciliacaoPorMov.set(i.movimento_id, { id: i.conciliacao_id, tipo: c?.tipo ?? null, em: c?.confirmada_em ?? null });
  }

  // Sugestões: completa os itens que não vieram nas listas acima.
  type ItemSug = { movimento_id: string | null; lancamento_id: string | null; baixa_id: string | null; transferencia_id: string | null; valor: number };
  const itensDe = (s: (typeof sugestoesBrutas)[number]) => (s.conciliacao_itens ?? []) as unknown as ItemSug[];
  const lancPorId = new Map(lancamentos.map((l) => [l.id, l as LancRow]));
  const movPorId = new Map<string, { id: string; conta_financeira_id: string; data: string; valor: number; descricao: string }>(movimentos.map((m) => [m.id, m]));
  const baixaPorId = new Map(baixas.map((b) => [b.id, b]));
  const faltaLanc: string[] = [];
  const faltaMov: string[] = [];
  const faltaBaixa: string[] = [];
  for (const s of sugestoesBrutas) {
    for (const i of itensDe(s)) {
      if (i.lancamento_id && !lancPorId.has(i.lancamento_id)) faltaLanc.push(i.lancamento_id);
      if (i.movimento_id && !movPorId.has(i.movimento_id)) faltaMov.push(i.movimento_id);
      if (i.baixa_id && !baixaPorId.has(i.baixa_id)) faltaBaixa.push(i.baixa_id);
    }
  }
  const [lancExtra, movExtra, baixaExtra] = await Promise.all([
    emLotes(faltaLanc, (lote) => supabase.from("lancamentos").select(CAMPOS_LANC).eq("empresa_id", empresaId).in("id", lote)),
    emLotes(faltaMov, (lote) => supabase.from("movimentos_bancarios").select(CAMPOS_MOV).eq("empresa_id", empresaId).in("id", lote)),
    emLotes(faltaBaixa, (lote) =>
      supabase
        .from("baixas")
        .select("id, tipo, valor_total, data_pagamento, conta_financeira_id, lancamento:lancamentos(descricao, contraparte:contrapartes(nome))")
        .eq("empresa_id", empresaId)
        .in("id", lote),
    ),
  ]);
  for (const l of lancExtra) lancPorId.set(l.id, l as LancRow);
  for (const m of movExtra) movPorId.set(m.id, m);
  const baixasExtraAtivas = new Set(
    (await emLotes(baixaExtra.map((b) => b.id), (lote) => supabase.from("conciliacao_itens").select("baixa_id").eq("ativo", true).in("baixa_id", lote))).map((i) => i.baixa_id),
  );
  for (const b of baixaExtra) {
    baixaPorId.set(b.id, b);
    if (baixasExtraAtivas.has(b.id)) baixasAtivas.add(b.id);
  }

  const paraBaixa = (b: (typeof baixas)[number]): BaixaLivre => {
    const lanc = b.lancamento as { descricao: string; contraparte: Nome } | null;
    return {
      id: b.id,
      tipo: b.tipo as BaixaLivre["tipo"],
      total: dec(b.valor_total).toFixed(2),
      data: b.data_pagamento,
      conta_id: b.conta_financeira_id,
      descricao: [lanc?.descricao, lanc?.contraparte?.nome].filter(Boolean).join(" · "),
    };
  };

  const idsNoFiltro = new Set(movimentos.filter((m) => m.status_conciliacao === "pendente").map((m) => m.id));
  const movEmSugestao = new Set<string>();
  const sugestoes: SugestaoTela[] = [];
  for (const s of sugestoesBrutas) {
    const itens = itensDe(s);
    for (const i of itens) if (i.movimento_id) movEmSugestao.add(i.movimento_id);
    if (!itens.some((i) => i.movimento_id && idsNoFiltro.has(i.movimento_id))) continue;
    let incompleta = false;
    const lancs: LancamentoAberto[] = [];
    const bxs: BaixaLivre[] = [];
    const movs: SugestaoTela["movimentos"] = [];
    for (const i of itens) {
      if (i.movimento_id) {
        const m = movPorId.get(i.movimento_id);
        if (!m) incompleta = true;
        else movs.push({ id: m.id, data: m.data, descricao: m.descricao, valor: dec(m.valor).toFixed(2), conta: nomeConta.get(m.conta_financeira_id) ?? "Conta" });
      } else if (i.lancamento_id) {
        const l = lancPorId.get(i.lancamento_id);
        if (!l || !["aberto", "parcial"].includes(l.situacao) || l.status_revisao !== "confirmado") incompleta = true;
        if (l) lancs.push(paraLancamento(l));
      } else if (i.baixa_id) {
        const b = baixaPorId.get(i.baixa_id);
        if (!b || baixasAtivas.has(b.id)) incompleta = true;
        if (b) bxs.push(paraBaixa(b));
      }
    }
    sugestoes.push({
      id: s.id,
      tipo: s.tipo,
      pontuacao: s.pontuacao,
      observacao: s.observacao,
      criterios: (s.criterios ?? {}) as Record<string, unknown>,
      movimentos: movs,
      lancamentos: lancs,
      baixas: bxs,
      incompleta,
    });
  }

  const movimentosTela: MovimentoTela[] = movimentos.map((m) => {
    const c = conciliacaoPorMov.get(m.id);
    return {
      id: m.id,
      conta_id: m.conta_financeira_id,
      conta: nomeConta.get(m.conta_financeira_id) ?? "Conta inativa",
      data: m.data,
      valor: dec(m.valor).toFixed(2),
      descricao: m.descricao,
      documento: m.documento_contraparte,
      status: m.status_conciliacao as MovimentoTela["status"],
      ignorado_motivo: m.ignorado_motivo,
      conciliacao_id: c?.id ?? null,
      conciliacao_tipo: c?.tipo ?? null,
      conciliada_em: c?.em ?? null,
      em_sugestao: movEmSugestao.has(m.id),
    };
  });

  const transferenciasLivres: TransferenciaLivre[] = transferencias
    .map((t) => ({
      id: t.id,
      data: t.data,
      valor: dec(t.valor).toFixed(2),
      origem_id: t.conta_origem_id,
      destino_id: t.conta_destino_id,
      origem: nomeConta.get(t.conta_origem_id) ?? "Conta",
      destino: nomeConta.get(t.conta_destino_id) ?? "Conta",
      descricao: t.descricao,
      // O lado já conciliado não volta a ser oferecido para a mesma conta.
      origem_conciliada: Boolean(ladosConciliados.get(t.id)?.has(t.conta_origem_id)),
      destino_conciliada: Boolean(ladosConciliados.get(t.id)?.has(t.conta_destino_id)),
    }))
    .filter((t) => !(t.origem_conciliada && t.destino_conciliada));

  return {
    movimentos: movimentosTela,
    sugestoes,
    totalSugestoes: sugestoesBrutas.length,
    pendentesForaPeriodo: foraPeriodo.count ?? 0,
    lancamentos: lancamentos.map((l) => paraLancamento(l as LancRow)).filter((l) => dec(l.aberto).isPositive()),
    lancamentosTruncados: lancamentos.length >= 5_000,
    baixas: baixas.filter((b) => !baixasAtivas.has(b.id)).map(paraBaixa),
    transferencias: transferenciasLivres,
    categorias: (categorias.data ?? []).filter((c) => !c.sintetica).map((c): CategoriaOpcao => ({ id: c.id, nome: `${c.codigo} ${c.nome}`, natureza: c.natureza ?? "" })),
    contrapartes: (contrapartes.data ?? []) as Opcao[],
    saldos: saldos.data ?? [],
    erroSaldos: saldos.error?.message ?? null,
  };
}
