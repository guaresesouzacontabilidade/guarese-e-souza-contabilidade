import "server-only";
import { obterContextoEmpresa } from "@/lib/auth/sessao";

/** Contexto da empresa com o estado da gestão da loja (o banco confere de novo em cada operação). */
export async function obterContextoLoja(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  const ativa = ctx.acesso.loja;
  const notas = ctx.acesso.gestao_modalidade === "notas";
  return {
    ...ctx,
    lojaAtiva: ativa,
    /** Modalidade "notas e transporte": sem caixa, vendas e estoque; só ordens de carregamento e notas. */
    notas,
    /** Modalidade "hotel": a loja vira o restaurante e bar do hotel (mesmo caixa, produtos e estoque). */
    hotel: ctx.acesso.gestao_modalidade === "hotel",
    vende: ativa && !notas && ctx.pode("gestao.vender"),
    gerente: ativa && ctx.pode("gestao.gerenciar"),
    /** Faz ordens de carregamento (modalidade notas, com a permissão de emitir NF-e). */
    carrega: ativa && notas && ctx.pode("nfe.emitir"),
  };
}

/** Data de hoje no fuso do escritório (AAAA-MM-DD). */
export function hojeLocal() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
}

type Supa = Awaited<ReturnType<typeof obterContextoEmpresa>>["supabase"];

/** Contas para onde a sangria pode ir (todas as ativas, menos o próprio caixa da loja). */
export async function contasParaSangria(supabase: Supa, empresaId: string) {
  const [{ data: contas }, { data: cfg }] = await Promise.all([
    supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    supabase.from("gestao_config").select("conta_dinheiro_id").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  return (contas ?? []).filter((c) => c.id !== cfg?.conta_dinheiro_id && c.tipo !== "cartao_credito").map((c) => ({ id: c.id, nome: c.nome }));
}

/** Data de N dias atrás (AAAA-MM-DD, fuso do escritório). */
export function diasAtras(dias: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date(Date.now() - dias * 86400000));
}
