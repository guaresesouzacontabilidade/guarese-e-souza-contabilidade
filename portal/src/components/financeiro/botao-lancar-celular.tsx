"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Botão fixo no celular para lançar uma despesa ou receita de qualquer tela
 * do financeiro, à esquerda e acima da barra de atalhos (some no computador
 * e na própria tela de lançamento).
 */
export function BotaoLancarCelular({ base }: { base: string }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const caminho = usePathname();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  if (caminho?.startsWith(base)) return null;

  return (
    <div ref={caixa} className="fixed left-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-start gap-2 lg:hidden print:hidden">
      {aberto ? (
        <div className="flex flex-col items-start gap-2" role="menu" aria-label="Lançar" style={{ backgroundColor: "transparent" }}>
          <Link
            role="menuitem"
            href={`${base}?tipo=pagar`}
            onClick={() => setAberto(false)}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold shadow-lg"
          >
            <Minus className="size-4 text-perigo" /> Despesa
          </Link>
          <Link
            role="menuitem"
            href={`${base}?tipo=receber`}
            onClick={() => setAberto(false)}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold shadow-lg"
          >
            <Plus className="size-4 text-sucesso" /> Receita
          </Link>
        </div>
      ) : null}
      <button
        type="button"
        aria-label={aberto ? "Fechar" : "Lançar despesa ou receita"}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl [background-image:var(--gradiente)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        {aberto ? <X className="size-6" /> : <Plus className="size-6" />}
      </button>
    </div>
  );
}
