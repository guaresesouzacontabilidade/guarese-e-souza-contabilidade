import "server-only";
import { redirect } from "next/navigation";
import { exigirEquipe, type Sessao } from "@/lib/auth/sessao";

/**
 * Financeiro do escritório: administrador ou alguém da equipe autorizado por
 * ele. A regra mora no banco (a linha de configuração só aparece para quem
 * tem acesso); aqui só se evita abrir a tela sem acesso.
 */
export async function podeHonorarios(s: Pick<Sessao, "supabase">) {
  const { count } = await s.supabase.from("honorarios_config").select("id", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

export async function exigirHonorarios() {
  const s = await exigirEquipe();
  if (!(await podeHonorarios(s))) redirect("/escritorio?aviso=sem-acesso-honorarios");
  return s;
}
