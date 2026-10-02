import Link from "next/link";
import { cn } from "@/lib/utils";

/** Abas baseadas em URL (funcionam sem JavaScript e podem ser compartilhadas). */
export function AbasLink({ abas, ativa, className }: { abas: { valor: string; rotulo: string; href: string; contador?: number | null }[]; ativa: string; className?: string }) {
  return (
    <nav aria-label="Seções" className={cn("-mx-3 mb-5 overflow-x-auto px-3 sm:mx-0 sm:px-0", className)}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {abas.map((a) => {
          const ativo = a.valor === ativa;
          return (
            <li key={a.valor}>
              <Link
                href={a.href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                  ativo ? "border-primary font-semibold text-titulo" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {a.rotulo}
                {a.contador ? (
                  <span className="rounded-full bg-bege px-1.5 text-xs font-semibold text-secondary-foreground">{a.contador}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
