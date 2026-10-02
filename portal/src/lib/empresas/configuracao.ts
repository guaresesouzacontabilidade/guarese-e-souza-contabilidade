import "server-only";
import type { ContextoEmpresa } from "@/lib/auth/sessao";
import type { MembroLista } from "@/components/usuarios/lista-membros";
import type { ModeloChecklist, Opcao } from "@/components/checklist/modelos";
import type { Permissao } from "@/lib/permissoes";

type Supabase = ContextoEmpresa["supabase"];

/** Usuários vinculados à empresa (ativos e revogados), no formato da lista de membros. */
export async function carregarMembros(supabase: Supabase, empresaId: string): Promise<MembroLista[]> {
  const { data } = await supabase
    .from("empresa_membros")
    .select("id, user_id, papel, permissoes, ativo, convidado_em, revogado_em, motivo_revogacao, perfil:perfis!empresa_membros_user_id_fkey(nome, email, ultimo_acesso_em)")
    .eq("empresa_id", empresaId)
    .order("ativo", { ascending: false });
  return (data ?? []).map((m) => {
    const p = m.perfil as unknown as { nome: string; email: string; ultimo_acesso_em: string | null } | null;
    return { ...m, permissoes: m.permissoes as Permissao[], nome: p?.nome ?? "—", email: p?.email ?? "", ultimo_acesso_em: p?.ultimo_acesso_em ?? null };
  });
}

/** Dados para a configuração dos modelos do checklist mensal da empresa. */
export async function carregarChecklist(supabase: Supabase, empresaId: string) {
  const [{ data: modelos }, { data: categorias }, { data: clientes }, { data: equipe }] = await Promise.all([
    supabase.from("checklist_modelos").select("*").eq("empresa_id", empresaId).order("ordem").order("titulo"),
    supabase.from("categorias_documento").select("codigo, nome, escritorio").eq("ativo", true).order("ordem"),
    supabase
      .from("empresa_membros")
      .select("user_id, perfil:perfis!empresa_membros_user_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .neq("papel", "equipe"),
    supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
  ]);
  return {
    modelos: (modelos ?? []) as ModeloChecklist[],
    categorias: categorias ?? [],
    clientes: (clientes ?? []).map((c): Opcao => ({ id: c.user_id, nome: (c.perfil as unknown as { nome: string } | null)?.nome ?? "—" })),
    equipe: (equipe ?? []) as Opcao[],
  };
}
