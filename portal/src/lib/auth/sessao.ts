import "server-only";
import { cache } from "react";
import { redirect, notFound } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { TODAS_PERMISSOES, type Permissao } from "@/lib/permissoes";

export type Perfil = Database["public"]["Tables"]["perfis"]["Row"];
export type Empresa = Database["public"]["Tables"]["empresas"]["Row"];

export interface EstadoAcesso {
  autenticado: boolean;
  perfil_existe?: boolean;
  ativo?: boolean;
  tipo?: "admin" | "equipe" | "cliente";
  sessao_valida?: boolean;
  aal?: "aal1" | "aal2";
  tem_fator_verificado?: boolean;
  exige_2fa?: boolean;
  aceite_termos_versao?: string | null;
  valido?: boolean;
}

/** Sessão do usuário atual (memorizada por requisição). */
export const obterSessao = cache(async () => {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const [{ data: perfil }, { data: estado }] = await Promise.all([
    supabase.from("perfis").select("*").eq("id", claims.sub).maybeSingle(),
    supabase.rpc("estado_acesso"),
  ]);
  return {
    supabase,
    usuarioId: claims.sub as string,
    sessaoId: (claims.session_id as string | undefined) ?? null,
    aal: (claims.aal as string | undefined) ?? "aal1",
    email: (claims.email as string | undefined) ?? perfil?.email ?? "",
    perfil: perfil as Perfil | null,
    estado: (estado ?? { autenticado: true }) as unknown as EstadoAcesso,
  };
});

export type Sessao = NonNullable<Awaited<ReturnType<typeof obterSessao>>>;

/**
 * Exige usuário autenticado e com acesso válido. Redireciona conforme o caso:
 * sem sessão → login; 2FA obrigatório → cadastro/verificação; inativo → login.
 */
export async function exigirSessao(): Promise<Sessao & { perfil: Perfil }> {
  const s = await obterSessao();
  if (!s) redirect("/login");
  const e = s.estado;
  if (!s.perfil || e.ativo === false) redirect("/auth/sair?motivo=inativo");
  if (e.sessao_valida === false) redirect("/auth/sair?motivo=sessao");
  if (e.tem_fator_verificado && e.aal !== "aal2") redirect("/mfa");
  if (e.exige_2fa && e.aal !== "aal2") redirect(e.tem_fator_verificado ? "/mfa" : "/mfa/cadastrar?obrigatorio=1");
  if (!e.aceite_termos_versao) redirect("/aceite");
  return s as Sessao & { perfil: Perfil };
}

export function ehEquipe(perfil: Perfil | null) {
  return perfil?.tipo === "admin" || perfil?.tipo === "equipe";
}

export async function exigirEquipe() {
  const s = await exigirSessao();
  if (!ehEquipe(s.perfil)) redirect("/painel");
  return s;
}

export async function exigirAdmin() {
  const s = await exigirSessao();
  if (s.perfil.tipo !== "admin") redirect("/painel");
  return s;
}

export interface EmpresaAcesso {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  documento: string;
  tipo_pessoa: string;
  regime_tributario: string;
  ativa: boolean;
  demonstracao: boolean;
  papel: "admin" | "equipe" | "cliente_titular" | "cliente_colaborador";
  permissoes: Set<Permissao>;
}

/** Empresas acessíveis ao usuário, com o papel e as permissões em cada uma. */
export const obterEmpresasDoUsuario = cache(async (): Promise<EmpresaAcesso[]> => {
  const s = await obterSessao();
  if (!s?.perfil) return [];
  const campos = "id, razao_social, nome_fantasia, documento, tipo_pessoa, regime_tributario, ativa, demonstracao";
  if (s.perfil.tipo === "admin") {
    const { data } = await s.supabase.from("empresas").select(campos).order("razao_social");
    return (data ?? []).map((e) => ({ ...e, papel: "admin" as const, permissoes: new Set(TODAS_PERMISSOES) }));
  }
  const { data } = await s.supabase
    .from("empresa_membros")
    .select(`papel, permissoes, empresa:empresas!inner(${campos})`)
    .eq("user_id", s.usuarioId)
    .eq("ativo", true);
  return (data ?? [])
    .map((m) => {
      const e = m.empresa as unknown as Omit<EmpresaAcesso, "papel" | "permissoes">;
      return { ...e, papel: m.papel as EmpresaAcesso["papel"], permissoes: new Set(m.permissoes as Permissao[]) };
    })
    .sort((a, b) => (a.nome_fantasia ?? a.razao_social).localeCompare(b.nome_fantasia ?? b.razao_social, "pt-BR"));
});

/** Contexto de uma empresa (404 quando o usuário não tem acesso). */
export async function obterContextoEmpresa(empresaId: string) {
  const s = await exigirSessao();
  const empresas = await obterEmpresasDoUsuario();
  const acesso = empresas.find((e) => e.id === empresaId);
  if (!acesso) notFound();
  const pode = (p: Permissao) => acesso.permissoes.has(p);
  const equipe = acesso.papel === "admin" || acesso.papel === "equipe";
  return { sessao: s, acesso, pode, equipe, supabase: s.supabase };
}

export type ContextoEmpresa = Awaited<ReturnType<typeof obterContextoEmpresa>>;

/** Verificação para ações do servidor (o banco também valida via RLS). */
export async function exigirPermissao(empresaId: string, permissao: Permissao) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode(permissao)) {
    throw new Error("Você não tem permissão para esta operação.");
  }
  return ctx;
}

/**
 * Para rotas de API: devolve a sessão somente se estiver válida (ativa, não
 * revogada, com 2FA quando exigido e termos aceitos). Não redireciona.
 */
export async function sessaoApi() {
  const s = await obterSessao();
  if (!s?.perfil) return null;
  const e = s.estado;
  if (e.ativo === false || e.sessao_valida === false) return null;
  if ((e.tem_fator_verificado || e.exige_2fa) && e.aal !== "aal2") return null;
  if (!e.aceite_termos_versao) return null;
  return s as Sessao & { perfil: Perfil };
}
