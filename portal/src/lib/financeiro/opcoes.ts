import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { OpcoesLancamento } from "@/components/financeiro/formulario-lancamento";

/** Listas usadas nos formulários financeiros (categorias, contrapartes, contas...). */
export async function carregarOpcoes(ctx: ContextoEmpresa, empresaId: string): Promise<OpcoesLancamento> {
  const [cat, contra, centros, projetos, contas] = await Promise.all([
    ctx.supabase.from("categorias_financeiras").select("id, codigo, nome, natureza, tipo, sintetica").eq("empresa_id", empresaId).eq("ativa", true).order("codigo"),
    ctx.supabase.from("contrapartes").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome").limit(2000),
    ctx.supabase.from("centros_custo").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("projetos").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
  ]);
  return {
    categorias: (cat.data ?? []).filter((c) => !c.sintetica).map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, natureza: c.natureza ?? "", tipo: c.tipo })),
    contrapartes: contra.data ?? [],
    centros: centros.data ?? [],
    projetos: projetos.data ?? [],
    contas: contas.data ?? [],
  };
}
