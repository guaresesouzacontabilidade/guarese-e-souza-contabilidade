import "server-only";
import { obterContextoEmpresa } from "@/lib/auth/sessao";

/**
 * Contexto da empresa com o estado da clínica veterinária (o banco confere de
 * novo em cada operação): recepção, responsável e o veterinário ligado a quem
 * está usando o portal (os atos clínicos são assinados por ele).
 */
export async function obterContextoClinica(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  const ativa = ctx.acesso.loja && ctx.acesso.gestao_modalidade === "veterinaria";
  const recepcao = ativa && ctx.pode("gestao.vender");
  const { data: veterinario } = recepcao
    ? await ctx.supabase
        .from("vet_veterinarios")
        .select("id, nome, crmv, crmv_uf, cadastro_mapa")
        .eq("empresa_id", empresaId)
        .eq("perfil_id", ctx.sessao.usuarioId)
        .eq("ativo", true)
        .maybeSingle()
    : { data: null };
  return {
    ...ctx,
    clinicaAtiva: ativa,
    /** Recepção: agenda, tutores e animais, contas e lembretes. */
    recepcao,
    /** Responsável: veterinários, vacinas, serviços, configurações, estornos e exclusões. */
    gerente: ativa && ctx.pode("gestao.gerenciar"),
    /** Veterinário ligado ao usuário: prontuário, receitas, vacinas aplicadas e atestados. */
    veterinario: veterinario ?? null,
  };
}

export type ContextoClinica = Awaited<ReturnType<typeof obterContextoClinica>>;

/** Data de hoje no fuso do escritório (AAAA-MM-DD). */
export function hojeClinica() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
