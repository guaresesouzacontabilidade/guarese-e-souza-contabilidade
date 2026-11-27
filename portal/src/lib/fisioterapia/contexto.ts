import "server-only";
import { obterContextoEmpresa } from "@/lib/auth/sessao";

/**
 * Contexto da empresa com o estado da clínica de fisioterapia (o banco confere
 * de novo em cada operação): recepção, responsável e o fisioterapeuta ligado a
 * quem está usando o portal (os registros do prontuário são assinados por ele,
 * e só os fisioterapeutas da clínica leem o prontuário).
 */
export async function obterContextoFisio(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  const ativa = ctx.acesso.loja && ctx.acesso.gestao_modalidade === "fisioterapia";
  const { data: profissional } = ativa
    ? await ctx.supabase
        .from("fisio_profissionais")
        .select("id, nome, crefito, crefito_regiao")
        .eq("empresa_id", empresaId)
        .eq("perfil_id", ctx.sessao.usuarioId)
        .eq("ativo", true)
        .maybeSingle()
    : { data: null };
  const recepcao = ativa && (ctx.pode("gestao.vender") || Boolean(profissional));
  return {
    ...ctx,
    clinicaAtiva: ativa,
    /** Recepção: agenda, pacientes, pacotes e recebimentos. */
    recepcao,
    /** Responsável: fisioterapeutas, configurações, repasse e estornos. */
    gerente: ativa && ctx.pode("gestao.gerenciar"),
    /** Fisioterapeuta ligado ao usuário: lê e registra o prontuário. */
    profissional: profissional ?? null,
  };
}

export type ContextoFisio = Awaited<ReturnType<typeof obterContextoFisio>>;
