/**
 * Cores e ícones do mapa da carteira (servidor e navegador).
 * Cada situação tem ícone e texto, além da cor: dá para entender sem depender só dela.
 */
import { Check, CircleAlert, CircleDashed, Clock, Minus, TriangleAlert, UserRound, type LucideIcon } from "lucide-react";
import type { SituacaoEmpresa, StatusEtapa } from "@/lib/operacional/mapa";
import { cn } from "@/lib/utils";

export const CLASSE_STATUS: Record<StatusEtapa, string> = {
  ok: "border-sucesso/30 bg-sucesso-bg text-sucesso-fg",
  andamento: "border-info/30 bg-info-bg text-info-fg",
  afazer: "border-border bg-muted text-muted-foreground",
  perto: "border-alerta/40 bg-alerta-bg text-alerta-fg",
  atraso: "border-perigo bg-perigo text-white dark:text-[#070a12]",
  cliente: "border-primary/30 bg-primary/10 text-primary",
  na: "border-dashed border-border bg-card text-muted-foreground",
};

export const ICONE_STATUS: Record<StatusEtapa, LucideIcon> = {
  ok: Check,
  andamento: Clock,
  afazer: CircleDashed,
  perto: TriangleAlert,
  atraso: CircleAlert,
  cliente: UserRound,
  na: Minus,
};

export const CLASSE_SITUACAO: Record<SituacaoEmpresa, string> = {
  atraso: "bg-perigo-bg text-perigo-fg",
  cliente: "bg-primary/10 text-primary",
  perto: "bg-alerta-bg text-alerta-fg",
  emdia: "bg-info-bg text-info-fg",
  fechado: "bg-sucesso-bg text-sucesso-fg",
};

/** Quadradinho de cor da situação (cartões de resumo). */
export const CLASSE_MARCA_SITUACAO: Record<SituacaoEmpresa | "todas", string> = {
  todas: "bg-primary border-primary",
  fechado: "bg-sucesso-bg border-sucesso",
  emdia: "bg-info-bg border-info",
  perto: "bg-alerta-bg border-alerta",
  atraso: "bg-perigo border-perigo",
  cliente: "bg-primary/10 border-primary",
};

export const CLASSE_PRAZO = { atraso: "text-perigo", perto: "text-alerta", normal: "text-foreground" } as const;

export function IconeStatus({ status, className }: { status: StatusEtapa; className?: string }) {
  const Icone = ICONE_STATUS[status];
  return <Icone aria-hidden className={cn("size-3.5 shrink-0", className)} />;
}
