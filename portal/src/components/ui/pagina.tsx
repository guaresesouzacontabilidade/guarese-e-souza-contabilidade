import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
  voltar,
  className,
}: {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
  voltar?: { href: string; rotulo: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        {voltar ? (
          <Link href={voltar.href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5" /> {voltar.rotulo}
          </Link>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{titulo}</h1>
        {descricao ? <p className="text-sm text-muted-foreground">{descricao}</p> : null}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

/** Paginação por links (preserva os filtros da URL). */
export function Paginacao({
  pagina,
  totalPaginas,
  total,
  montarHref,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  montarHref: (p: number) => string;
}) {
  if (totalPaginas <= 1) return total > 0 ? <p className="mt-3 text-xs text-muted-foreground">{total} registro(s)</p> : null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-2 text-sm" aria-label="Paginação">
      <p className="text-xs text-muted-foreground">
        Página {pagina} de {totalPaginas} · {total} registro(s)
      </p>
      <div className="flex gap-1">
        {pagina > 1 ? (
          <Link href={montarHref(pagina - 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 hover:bg-muted">
            <ChevronLeft className="size-4" /> Anterior
          </Link>
        ) : null}
        {pagina < totalPaginas ? (
          <Link href={montarHref(pagina + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 hover:bg-muted">
            Próxima <ChevronRight className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Monta URL preservando parâmetros de busca. */
export function urlCom(base: string, params: Record<string, string | string[] | undefined>, alteracoes: Record<string, string | number | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v !== "") u.set(k, v);
  }
  for (const [k, v] of Object.entries(alteracoes)) {
    if (v === null || v === undefined || v === "") u.delete(k);
    else u.set(k, String(v));
  }
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
}

export function Indicador({
  rotulo,
  valor,
  detalhe,
  tom = "neutro",
  href,
  icone: Icone,
  className,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  tom?: "neutro" | "sucesso" | "alerta" | "perigo" | "info";
  href?: string;
  icone?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const cores = {
    neutro: "text-titulo",
    sucesso: "text-sucesso",
    alerta: "text-alerta",
    perigo: "text-perigo",
    info: "text-info",
  };
  const conteudo = (
    <div className={cn("h-full rounded-xl border border-border bg-card p-4 shadow-sm transition-colors", href && "hover:border-primary/40 hover:bg-muted/40", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        {Icone ? <Icone className="size-4 text-muted-foreground" /> : null}
      </div>
      <p className={cn("mt-2 text-2xl font-bold numero", cores[tom])}>{valor}</p>
      {detalhe ? <div className="mt-1 text-xs text-muted-foreground">{detalhe}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}
