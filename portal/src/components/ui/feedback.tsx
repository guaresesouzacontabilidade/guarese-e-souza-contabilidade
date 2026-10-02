import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, Loader2, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

type Tom = "info" | "sucesso" | "alerta" | "perigo";

const tons: Record<Tom, { classe: string; Icone: React.ComponentType<{ className?: string }> }> = {
  info: { classe: "border-info/30 bg-info-bg text-info-fg", Icone: Info },
  sucesso: { classe: "border-sucesso/30 bg-sucesso-bg text-sucesso-fg", Icone: CheckCircle2 },
  alerta: { classe: "border-alerta/40 bg-alerta-bg text-alerta-fg", Icone: AlertTriangle },
  perigo: { classe: "border-perigo/30 bg-perigo-bg text-perigo-fg", Icone: XCircle },
};

export function Alerta({
  tom = "info",
  titulo,
  children,
  className,
  acao,
}: {
  tom?: Tom;
  titulo?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  acao?: React.ReactNode;
}) {
  const { classe, Icone } = tons[tom];
  return (
    <div role={tom === "perigo" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3 text-sm", classe, className)}>
      <Icone className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {titulo ? <p className="font-semibold">{titulo}</p> : null}
        {children ? <div className="leading-relaxed">{children}</div> : null}
      </div>
      {acao ? <div className="shrink-0">{acao}</div> : null}
    </div>
  );
}

export function EstadoVazio({
  icone: Icone = Inbox,
  titulo,
  descricao,
  acao,
  className,
}: {
  icone?: React.ComponentType<{ className?: string }>;
  titulo: string;
  descricao?: React.ReactNode;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-bege-forte bg-muted/40 px-6 py-10 text-center", className)}>
      <div className="mb-3 rounded-full bg-bege p-3 text-primary">
        <Icone className="size-6" />
      </div>
      <p className="font-semibold text-titulo">{titulo}</p>
      {descricao ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{descricao}</p> : null}
      {acao ? <div className="mt-4">{acao}</div> : null}
    </div>
  );
}

export function Carregando({ texto = "Carregando...", className }: { texto?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground", className)}>
      <Loader2 className="size-4 animate-spin" />
      {texto}
    </div>
  );
}

export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function Progresso({ valor, className, rotulo }: { valor: number | null; className?: string; rotulo?: string }) {
  const v = valor == null ? 0 : Math.max(0, Math.min(100, valor));
  const cor = valor == null ? "bg-muted-foreground/30" : v >= 100 ? "bg-sucesso" : v >= 60 ? "bg-primary" : v >= 30 ? "bg-alerta" : "bg-perigo";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valor ?? undefined}
      aria-label={rotulo}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full transition-all", cor)} style={{ width: `${v}%` }} />
    </div>
  );
}
