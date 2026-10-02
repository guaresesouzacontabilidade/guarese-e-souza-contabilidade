"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";

export interface NotificacaoResumo {
  id: string;
  titulo: string;
  corpo: string | null;
  link: string | null;
  lida_em: string | null;
  created_at: string;
  empresa_id: string | null;
}

export async function listarNotificacoes(): Promise<{ itens: NotificacaoResumo[]; naoLidas: number }> {
  const supabase = await criarClienteServidor();
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notificacoes")
      .select("id, titulo, corpo, link, lida_em, created_at, empresa_id")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("notificacoes").select("id", { count: "exact", head: true }).is("lida_em", null),
  ]);
  return { itens: (data ?? []) as NotificacaoResumo[], naoLidas: count ?? 0 };
}

export async function marcarNotificacoesLidas(ids?: string[]) {
  const supabase = await criarClienteServidor();
  let q = supabase.from("notificacoes").update({ lida_em: new Date().toISOString() }).is("lida_em", null);
  if (ids?.length) q = q.in("id", ids);
  await q;
  revalidatePath("/", "layout");
}
