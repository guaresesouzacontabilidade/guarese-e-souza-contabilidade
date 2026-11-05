"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useSacola } from "@/lib/sacola";

export function BotaoSacola() {
  const { quantidade } = useSacola();
  const rotulo = quantidade ? `Sacola, ${quantidade} ${quantidade === 1 ? "item" : "itens"}` : "Sacola vazia";
  return (
    <Link href="/sacola" className="relative inline-flex size-11 items-center justify-center text-prata hover:text-white" aria-label={rotulo}>
      <ShoppingBag className="size-[22px]" strokeWidth={1.5} aria-hidden="true" />
      {quantidade ? (
        <span className="absolute right-0.5 top-0.5 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-prata px-1 text-[0.6875rem] font-semibold leading-[1.125rem] text-noite tabular-nums" aria-hidden="true">
          {quantidade > 99 ? "99+" : quantidade}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {quantidade ? `${quantidade} na sacola` : ""}
      </span>
    </Link>
  );
}
