import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import { dec, somar } from "@/lib/dinheiro";
import type { FormaPagamento } from "./rotulos";
import type { ProdutoLoja } from "@/components/loja/produtos";

type Cliente = ContextoEmpresa["supabase"];

export interface ResumoCaixa {
  abertura: number;
  vendas_quantidade: number;
  vendas_total: number;
  descontos: number;
  troco: number;
  canceladas_quantidade: number;
  canceladas_total: number;
  por_forma: Partial<Record<FormaPagamento, { valor: number; vendas: number }>>;
  sangrias: number;
  suprimentos: number;
  qtd_sangrias: number;
  qtd_suprimentos: number;
  dinheiro_esperado: number;
  contado?: number;
  diferenca?: number;
}

export interface VendaDoCaixa {
  id: string;
  numero: number;
  status: string;
  hora: string;
  cliente: string | null;
  vendedor: string | null;
  subtotal: string;
  desconto: string;
  frete: string;
  total: string;
  troco: string;
  motivo_cancelamento: string | null;
  nfe: boolean;
  itens: { descricao: string; unidade: string; pecas: string | null; comprimento_m: string | null; quantidade: string; preco_unitario: string; desconto: string; total: string }[];
  pagamentos: { forma: FormaPagamento; valor: string; valor_recebido: string | null; parcelas: number; primeiro_vencimento: string | null }[];
}

export interface MovimentoDoCaixa {
  id: string;
  tipo: "sangria" | "suprimento";
  valor: string;
  motivo: string;
  hora: string;
  conta: string | null;
  quem: string | null;
}

export interface ProdutoVendidoNoDia {
  descricao: string;
  unidade: string;
  quantidade: string;
  pecas: string | null;
  total: string;
}

export interface RelatorioCaixa {
  sessao: {
    id: string;
    empresa_id: string;
    caixa_nome: string;
    status: "aberto" | "fechado";
    data: string;
    aberto_em: string;
    fechado_em: string | null;
    valor_abertura: string;
    valor_contado: string | null;
    valor_esperado: string | null;
    diferenca: string | null;
    observacao_fechamento: string | null;
    operador_id: string;
    operador: string | null;
    fechado_por: string | null;
  };
  resumo: ResumoCaixa;
  vendas: VendaDoCaixa[];
  movimentos: MovimentoDoCaixa[];
  produtos: ProdutoVendidoNoDia[];
}

const nome = (p: unknown) => (p as { nome?: string } | null)?.nome ?? null;

/**
 * Tudo o que aconteceu num caixa: vendas (itens e pagamentos), sangrias,
 * suprimentos, resumo por forma de pagamento e o total por produto. Usado na
 * tela do caixa e no relatório do dia em PDF. O acesso segue as regras do banco.
 */
export async function carregarRelatorioCaixa(supabase: Cliente, sessaoId: string): Promise<RelatorioCaixa | null> {
  const { data: s } = await supabase
    .from("caixa_sessoes")
    .select(
      "id, empresa_id, caixa_nome, status, data, aberto_em, fechado_em, valor_abertura, valor_contado, valor_esperado, diferenca, observacao_fechamento, resumo, operador_id, operador:perfis!caixa_sessoes_operador_id_fkey(nome), fechador:perfis!caixa_sessoes_fechado_por_fkey(nome)",
    )
    .eq("id", sessaoId)
    .maybeSingle();
  if (!s) return null;

  const [resumoAoVivo, vendasR, movR] = await Promise.all([
    s.status === "aberto" ? supabase.rpc("gestao_caixa_resumo", { p_sessao_id: sessaoId }) : Promise.resolve({ data: s.resumo }),
    supabase
      .from("vendas")
      .select(
        "id, numero, status, created_at, cliente_nome, subtotal, desconto, frete, total, troco, motivo_cancelamento, nfe_emissao_id, vendedor:perfis!vendas_vendedor_id_fkey(nome), venda_itens(ordem, descricao, unidade, pecas, comprimento_m, quantidade, preco_unitario, desconto, total), venda_pagamentos(forma, valor, valor_recebido, parcelas, primeiro_vencimento)",
      )
      .eq("sessao_id", sessaoId)
      .eq("tipo", "venda")
      .order("numero"),
    supabase
      .from("caixa_movimentos")
      .select("id, tipo, valor, motivo, created_at, conta:contas_financeiras(nome), autor:perfis!caixa_movimentos_criado_por_fkey(nome)")
      .eq("sessao_id", sessaoId)
      .order("created_at"),
  ]);

  const vendas: VendaDoCaixa[] = (vendasR.data ?? []).map((v) => ({
    id: v.id,
    numero: Number(v.numero),
    status: v.status,
    hora: v.created_at,
    cliente: v.cliente_nome,
    vendedor: nome(v.vendedor),
    subtotal: String(v.subtotal),
    desconto: String(v.desconto),
    frete: String(v.frete),
    total: String(v.total),
    troco: String(v.troco),
    motivo_cancelamento: v.motivo_cancelamento,
    nfe: Boolean(v.nfe_emissao_id),
    itens: [...(v.venda_itens ?? [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((i) => ({
        descricao: i.descricao,
        unidade: i.unidade,
        pecas: i.pecas == null ? null : String(i.pecas),
        comprimento_m: i.comprimento_m == null ? null : String(i.comprimento_m),
        quantidade: String(i.quantidade),
        preco_unitario: String(i.preco_unitario),
        desconto: String(i.desconto),
        total: String(i.total),
      })),
    pagamentos: (v.venda_pagamentos ?? []).map((p) => ({
      forma: p.forma as FormaPagamento,
      valor: String(p.valor),
      valor_recebido: p.valor_recebido == null ? null : String(p.valor_recebido),
      parcelas: p.parcelas,
      primeiro_vencimento: p.primeiro_vencimento,
    })),
  }));

  // Total vendido por produto (só vendas concluídas)
  const porProduto = new Map<string, { descricao: string; unidade: string; quantidade: ReturnType<typeof dec>; pecas: ReturnType<typeof dec> | null; total: ReturnType<typeof dec> }>();
  for (const v of vendas) {
    if (v.status !== "concluida") continue;
    for (const i of v.itens) {
      const chave = `${i.descricao}|${i.unidade}`;
      const atual = porProduto.get(chave) ?? { descricao: i.descricao, unidade: i.unidade, quantidade: dec(0), pecas: null, total: dec(0) };
      atual.quantidade = atual.quantidade.plus(dec(i.quantidade));
      if (i.pecas != null) atual.pecas = (atual.pecas ?? dec(0)).plus(dec(i.pecas));
      atual.total = atual.total.plus(dec(i.total));
      porProduto.set(chave, atual);
    }
  }
  const produtos = [...porProduto.values()]
    .sort((a, b) => b.total.comparedTo(a.total))
    .map((p) => ({ descricao: p.descricao, unidade: p.unidade, quantidade: p.quantidade.toString(), pecas: p.pecas?.toString() ?? null, total: p.total.toFixed(2) }));

  const movimentos: MovimentoDoCaixa[] = (movR.data ?? []).map((m) => ({
    id: m.id,
    tipo: m.tipo as MovimentoDoCaixa["tipo"],
    valor: String(m.valor),
    motivo: m.motivo,
    hora: m.created_at,
    conta: nome(m.conta),
    quem: nome(m.autor),
  }));

  const resumo = (resumoAoVivo.data ?? {}) as unknown as ResumoCaixa;
  return {
    sessao: {
      id: s.id,
      empresa_id: s.empresa_id,
      caixa_nome: s.caixa_nome,
      status: s.status as "aberto" | "fechado",
      data: s.data,
      aberto_em: s.aberto_em,
      fechado_em: s.fechado_em,
      valor_abertura: String(s.valor_abertura),
      valor_contado: s.valor_contado == null ? null : String(s.valor_contado),
      valor_esperado: s.valor_esperado == null ? null : String(s.valor_esperado),
      diferenca: s.diferenca == null ? null : String(s.diferenca),
      observacao_fechamento: s.observacao_fechamento,
      operador_id: s.operador_id,
      operador: nome(s.operador),
      fechado_por: nome(s.fechador),
    },
    resumo,
    vendas,
    movimentos,
    produtos,
  };
}

/** Soma de uma forma de pagamento no resumo (0 quando não houve). */
export function valorDaForma(r: ResumoCaixa, forma: FormaPagamento) {
  return dec(r.por_forma?.[forma]?.valor ?? 0);
}

/** Total recebido em cartão (débito + crédito). */
export function totalCartao(r: ResumoCaixa) {
  return somar([r.por_forma?.cartao_debito?.valor, r.por_forma?.cartao_credito?.valor]);
}


/** Produtos da loja (cadastro único com a NF-e), com os números em texto para o navegador. */
export async function carregarProdutosLoja(supabase: Cliente, empresaId: string, opcoes: { ativos?: boolean } = {}) {
  let q = supabase
    .from("nfe_produtos")
    .select("id, codigo, descricao, ncm, cest, gtin, unidade, grupo, valor_unitario, preco_custo, controla_estoque, estoque_atual, estoque_minimo, custo_medio, ativo, espessura_cm, largura_cm, comprimento_m")
    .eq("empresa_id", empresaId)
    .order("descricao")
    .limit(5000);
  if (opcoes.ativos) q = q.eq("ativo", true);
  const { data } = await q;
  const t = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return (data ?? []).map(
    (p): ProdutoLoja => ({
      id: p.id,
      codigo: p.codigo,
      descricao: p.descricao,
      ncm: p.ncm,
      cest: p.cest,
      gtin: p.gtin,
      unidade: p.unidade,
      grupo: p.grupo,
      valor_unitario: t(p.valor_unitario),
      preco_custo: t(p.preco_custo),
      controla_estoque: p.controla_estoque,
      estoque_atual: String(p.estoque_atual ?? 0),
      estoque_minimo: t(p.estoque_minimo),
      custo_medio: t(p.custo_medio),
      ativo: p.ativo,
      espessura_cm: t(p.espessura_cm),
      largura_cm: t(p.largura_cm),
      comprimento_m: t(p.comprimento_m),
    }),
  );
}

/** Estoque abaixo do mínimo (ou zerado/negativo). */
export function estoqueBaixo(p: ProdutoLoja) {
  if (!p.controla_estoque || !p.ativo) return false;
  const atual = dec(p.estoque_atual);
  return atual.lte(0) || (p.estoque_minimo != null && atual.lt(dec(p.estoque_minimo)));
}
