"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Navegação secundária (abas por rota), destacando a seção atual. */
export function SubNavegacao({ itens, className }: { itens: { rotulo: string; href: string; exato?: boolean }[]; className?: string }) {
  const caminho = usePathname();
  return (
    <nav aria-label="Seções" className={cn("-mx-3 mb-5 overflow-x-auto px-3 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {itens.map((i) => {
          const ativo = i.exato ? caminho === i.href : caminho === i.href || caminho.startsWith(i.href + "/");
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center border-b-2 px-3 py-2.5 text-sm transition-colors",
                  ativo ? "border-primary font-semibold text-titulo" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {i.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
