"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Iniciais do nome da empresa (sem "LTDA", "ME", "(DEMO)"...), para quando não há logo. */
function iniciais(nome: string) {
  const palavras = nome
    .replace(/\(.*?\)/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1 && !/^(ltda|me|epp|eireli|s\.?a\.?|da|de|do|das|dos|e)$/i.test(p));
  return (palavras.slice(0, 2).map((p) => p[0]).join("") || nome.slice(0, 2)).toUpperCase();
}

const TAMANHOS = {
  /** Topo da página e lista de empresas */
  sm: { caixa: "h-9 max-w-[7.5rem] min-w-9", letra: "text-xs" },
  /** Menu lateral */
  md: { caixa: "h-14 w-full", letra: "text-base" },
  /** Cartão de boas-vindas da visão geral */
  lg: { caixa: "h-20 max-w-[16rem] min-w-20 sm:h-24", letra: "text-2xl" },
} as const;

/**
 * Logo da empresa (enviada no cadastro) num fundo claro, para aparecer bem
 * nos temas claro e escuro. Sem logo (ou se a imagem não carregar), mostra
 * as iniciais do nome.
 */
export function MarcaEmpresa({ nome, logo, tamanho = "sm", className }: { nome: string; logo: string | null; tamanho?: keyof typeof TAMANHOS; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  const t = TAMANHOS[tamanho];
  if (logo && !falhou) {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-1", t.caixa, className)}>
        {/* A logo vem do armazenamento privado pela rota da empresa (só quem tem acesso recebe) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={`Logo de ${nome}`} className="h-full w-auto max-w-full object-contain" onError={() => setFalhou(true)} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[color-mix(in_srgb,var(--primary)_55%,#14b8a6)] font-bold text-white",
        tamanho === "md" ? "h-14 w-14" : tamanho === "lg" ? "h-20 w-20 sm:h-24 sm:w-24" : "h-9 w-9",
        t.letra,
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}
