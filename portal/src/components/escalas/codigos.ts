import type { CSSProperties } from "react";
import { descreverTurno } from "@/lib/escalas/horas";
import type { Turno } from "@/lib/escalas/tipos";

/** Cores dos turnos na grade (as mesmas dos gráficos, que acompanham o tema). */
const CORES = ["var(--grafico-1)", "var(--grafico-2)", "var(--grafico-3)", "var(--grafico-5)", "var(--grafico-4)", "var(--grafico-6)", "var(--grafico-1)", "var(--grafico-2)", "var(--grafico-3)"];

export function corDoTurno(turnos: Turno[], id: string) {
  const i = turnos.findIndex((t) => t.id === id);
  return CORES[(i < 0 ? 0 : i) % CORES.length];
}

/** Sigla curta de cada turno (M, T, N...; se repetir, duas letras; se ainda repetir, o código). */
export function siglasDosTurnos(turnos: Turno[]): Map<string, string> {
  // F, FÉ e AF são da folga, férias e afastamento: nenhum turno pode usar
  const usadas = new Set(["F", "FE", "FÉ", "AF"]);
  const siglas = new Map<string, string>();
  for (const t of turnos) {
    const letras = t.nome.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const sigla = [letras.slice(0, 1), letras.slice(0, 2), letras.slice(0, 3), t.id].find((s) => s && !usadas.has(s)) ?? t.id;
    usadas.add(sigla);
    siglas.set(t.id, sigla);
  }
  return siglas;
}

export const AUSENCIA_VISUAL: Record<string, { curto: string; longo: string; classe: string }> = {
  F: { curto: "F", longo: "Folga", classe: "bg-muted text-muted-foreground" },
  FE: { curto: "FÉ", longo: "Férias", classe: "bg-info-bg text-info-fg" },
  AF: { curto: "AF", longo: "Afastamento", classe: "bg-alerta-bg text-alerta-fg" },
};

export function visualDoCodigo(codigo: string, turnos: Turno[], siglas: Map<string, string>): { curto: string; longo: string; classe: string; estilo?: CSSProperties } {
  const a = AUSENCIA_VISUAL[codigo];
  if (a) return a;
  const t = turnos.find((x) => x.id === codigo);
  if (!t) return { curto: "?", longo: "Sem definição", classe: "bg-perigo-bg text-perigo-fg" };
  const cor = corDoTurno(turnos, codigo);
  return {
    curto: siglas.get(codigo) ?? codigo,
    longo: `${t.nome} (${descreverTurno(t)})`,
    classe: "font-semibold text-foreground",
    estilo: { backgroundColor: `color-mix(in srgb, ${cor} 24%, transparent)`, boxShadow: `inset 0 -2px 0 ${cor}` },
  };
}
