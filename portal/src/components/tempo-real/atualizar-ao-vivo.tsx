"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { criarClienteNavegador } from "@/lib/supabase/client";

export interface AssinaturaAoVivo {
  tabela: string;
  /** Filtro do Supabase Realtime, ex.: `conversa_id=eq.<id>`. */
  filtro?: string;
  evento?: "*" | "INSERT" | "UPDATE" | "DELETE";
}

/**
 * Recarrega os dados da página (sem recarregar a página inteira) quando algo
 * muda no banco. O banco só entrega as mudanças que a pessoa pode ver (RLS).
 */
export function AtualizarAoVivo({ canal, assinaturas }: { canal: string; assinaturas: AssinaturaAoVivo[] }) {
  const router = useRouter();
  const especificacao = JSON.stringify(assinaturas);
  useEffect(() => {
    const lista = JSON.parse(especificacao) as AssinaturaAoVivo[];
    const supabase = criarClienteNavegador();
    let assinatura: ReturnType<typeof supabase.channel> | null = null;
    let ativo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    // Várias mudanças seguidas geram uma única atualização.
    const atualizar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => router.refresh(), 250);
    };
    const assinar = async () => {
      // O canal precisa se identificar com a sessão antes de entrar (regras de acesso).
      await supabase.realtime.setAuth();
      if (!ativo) return;
      let c = supabase.channel(`${canal}-${crypto.randomUUID()}`);
      for (const a of lista) {
        c = c.on("postgres_changes", { event: a.evento ?? "*", schema: "public", table: a.tabela, ...(a.filtro ? { filter: a.filtro } : {}) }, atualizar);
      }
      assinatura = c.subscribe();
    };
    assinar().catch(() => {});
    return () => {
      ativo = false;
      clearTimeout(espera);
      if (assinatura) supabase.removeChannel(assinatura);
    };
  }, [canal, especificacao, router]);
  return null;
}

/** Leva a tela até a última mensagem quando chega uma nova (a primeira abertura não rola). */
export function RolarAoChegar({ quantidade }: { quantidade: number }) {
  const ancora = useRef<HTMLDivElement>(null);
  const anterior = useRef(quantidade);
  useEffect(() => {
    if (quantidade > anterior.current) ancora.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    anterior.current = quantidade;
  }, [quantidade]);
  return <div ref={ancora} aria-hidden />;
}
