import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { OpcoesLancamento } from "@/components/financeiro/formulario-lancamento";
import type { LancamentoHistorico } from "@/lib/financeiro/sugestao-conta";

/**
 * Listas usadas nos formulários financeiros (categorias, contrapartes, contas...)
 * e o histórico recente da própria empresa para as contas mais usadas e a
 * sugestão de conta pelo fornecedor ou pela descrição.
 */
export async function carregarOpcoes(ctx: ContextoEmpresa, empresaId: string): Promise<OpcoesLancamento> {
  const [cat, contra, centros, projetos, contas, historico, baixas] = await Promise.all([
    ctx.supabase.from("categorias_financeiras").select("id, codigo, nome, natureza, tipo, sintetica").eq("empresa_id", empresaId).eq("ativa", true).order("codigo"),
    ctx.supabase.from("contrapartes").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome").limit(2000),
    ctx.supabase.from("centros_custo").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("projetos").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.supabase
      .from("lancamentos")
      .select("tipo, descricao, categoria_id, contraparte_id")
      .eq("empresa_id", empresaId)
      .eq("status_revisao", "confirmado")
      .neq("situacao", "cancelado")
      .not("categoria_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(300),
    ctx.supabase.from("baixas").select("tipo, conta_financeira_id").eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(30),
  ]);
  const ultima = (tipo: string) => (baixas.data ?? []).find((b) => b.tipo === tipo)?.conta_financeira_id ?? null;
  return {
    categorias: (cat.data ?? []).filter((c) => !c.sintetica).map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, natureza: c.natureza ?? "", tipo: c.tipo })),
    contrapartes: contra.data ?? [],
    centros: centros.data ?? [],
    projetos: projetos.data ?? [],
    contas: contas.data ?? [],
    historico: (historico.data ?? []) as LancamentoHistorico[],
    ultimaContaPagamento: { pagar: ultima("pagar"), receber: ultima("receber") },
  };
}
