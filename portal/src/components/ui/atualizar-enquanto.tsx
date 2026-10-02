"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** Atualiza a tela a cada poucos segundos enquanto algo está na fila (por até `limiteMs`). */
export function AtualizarEnquanto({ ativo, intervaloMs = 5000, limiteMs = 180_000 }: { ativo: boolean; intervaloMs?: number; limiteMs?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!ativo) return;
    const inicio = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - inicio > limiteMs) return window.clearInterval(id);
      router.refresh();
    }, intervaloMs);
    return () => window.clearInterval(id);
  }, [ativo, intervaloMs, limiteMs, router]);
  return null;
}
