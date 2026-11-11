"use client";

import * as React from "react";
import { Paintbrush } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultadoConferencia } from "@/lib/escalas/conferencia";
import { formatarHoras } from "@/lib/escalas/horas";
import { MODELO_POR_CHAVE } from "@/lib/escalas/modelos";
import { DIAS_CURTOS, diasDoMes, isoData, type ConfigEscala, type Grade } from "@/lib/escalas/tipos";
import { AUSENCIA_VISUAL, siglasDosTurnos, visualDoCodigo, corDoTurno } from "./codigos";

/** Barra do pincel: escolha o que pintar e clique nos dias. */
export function Pincel({ config, valor, aoMudar }: { config: ConfigEscala; valor: string; aoMudar: (c: string) => void }) {
  const siglas = siglasDosTurnos(config.turnos);
  const opcoes = [...config.turnos.map((t) => t.id), "F", "FE", "AF"];
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" role="radiogroup" aria-label="O que marcar ao clicar num dia">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Paintbrush className="size-3.5" /> Marcar:
      </span>
      {opcoes.map((c) => {
        const v = visualDoCodigo(c, config.turnos, siglas);
        const t = config.turnos.find((x) => x.id === c);
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={valor === c}
            onClick={() => aoMudar(c)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
              valor === c ? "border-primary ring-2 ring-primary/30" : "border-border hover:bg-muted",
            )}
          >
            <span className={cn("inline-flex size-6 items-center justify-center rounded text-[11px]", v.classe)} style={v.estilo}>
              {v.curto}
            </span>
            {t ? `${t.nome} ${t.inicio}–${t.fim}` : AUSENCIA_VISUAL[c].longo}
          </button>
        );
      })}
    </div>
  );
}

export function GradeEscala({
  config,
  competencia,
  grade,
  conferencia,
  aoClicar,
  destaque,
  compacta = false,
}: {
  config: ConfigEscala;
  competencia: string;
  grade: Grade;
  conferencia?: ResultadoConferencia;
  /** Sem esta função, a grade é só para ver. */
  aoClicar?: (pessoaId: string, diaIndice: number) => void;
  destaque?: { pessoaId?: string; dia?: number } | null;
  compacta?: boolean;
}) {
  const dias = diasDoMes(competencia);
  const siglas = siglasDosTurnos(config.turnos);
  const feriados = new Map(config.feriados.map((f) => [f.data, f.nome]));
  const problemas = new Map<string, "erro" | "alerta">();
  for (const a of conferencia?.achados ?? []) {
    if (!a.pessoaId || !a.dia || a.gravidade === "info") continue;
    const k = `${a.pessoaId}:${a.dia}`;
    if (a.gravidade === "erro" || !problemas.has(k)) problemas.set(k, a.gravidade);
  }
  const resumo = new Map((conferencia?.resumo ?? []).map((r) => [r.pessoaId, r]));
  const celula = compacta ? "size-7 text-[10px]" : "size-8 text-[11px]";
  const fundoDia = (d: Date) => {
    const iso = isoData(d);
    if (feriados.has(iso)) return "bg-alerta-bg/50";
    if (!config.funcionamento[d.getUTCDay()].aberto) return "bg-muted/60";
    if (d.getUTCDay() === 0) return "bg-muted/40";
    return "";
  };

  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-border bg-card print:overflow-visible print:border-black/30">
      <table className="border-separate border-spacing-0 text-xs">
        <caption className="sr-only">Escala do mês: uma linha por pessoa e uma coluna por dia</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-20 min-w-28 border-b border-r sm:min-w-40 border-border bg-card px-3 py-2 text-left font-semibold">
              Pessoa
            </th>
            {dias.map((d, i) => {
              const feriado = feriados.get(isoData(d));
              return (
                <th
                  key={i}
                  scope="col"
                  title={feriado ? `Feriado: ${feriado}` : undefined}
                  className={cn("border-b border-border px-0.5 py-1 text-center font-medium", fundoDia(d), d.getUTCDay() === 1 && i > 0 && "border-l border-l-border")}
                >
                  <span className="block tabular-nums">{d.getUTCDate()}</span>
                  <span className={cn("block text-[10px] font-normal text-muted-foreground", d.getUTCDay() === 0 && "font-semibold text-foreground")}>{DIAS_CURTOS[d.getUTCDay()].slice(0, 3)}</span>
                  {feriado ? <span className="block text-[9px] font-semibold text-alerta-fg">FER</span> : null}
                </th>
              );
            })}
            {!compacta ? (
              <>
                <th scope="col" className="border-b border-l border-border px-2 py-1 text-right font-medium">Horas</th>
                <th scope="col" className="border-b border-border px-2 py-1 text-right font-medium">Folgas</th>
                <th scope="col" className="border-b border-border px-2 py-1 text-right font-medium" title="Domingos de folga no mês">Dom.</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {config.pessoas.map((p) => {
            const codigos = grade[p.id] ?? [];
            const r = resumo.get(p.id);
            const linhaDestacada = destaque?.pessoaId === p.id;
            return (
              <tr key={p.id} className={cn(linhaDestacada && "bg-secondary/40")}>
                <th scope="row" className={cn("sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-1.5 text-left font-normal", linhaDestacada && "bg-secondary")}>
                  <span className="block max-w-28 truncate font-medium text-foreground sm:max-w-48">{p.nome}</span>
                  <span className="block max-w-28 truncate text-[11px] text-muted-foreground sm:max-w-48">
                    {MODELO_POR_CHAVE[p.modelo].nome}
                    {p.cargo ? ` · ${p.cargo}` : ""}
                  </span>
                </th>
                {dias.map((d, i) => {
                  const c = codigos[i] ?? "";
                  const v = visualDoCodigo(c, config.turnos, siglas);
                  const prob = problemas.get(`${p.id}:${i + 1}`);
                  const rotulo = `${p.nome}, ${DIAS_CURTOS[d.getUTCDay()]} ${d.getUTCDate()}: ${v.longo}${prob === "erro" ? " (fora da regra)" : prob === "alerta" ? " (atenção)" : ""}`;
                  const marcado = linhaDestacada && destaque?.dia === i + 1;
                  const conteudo = (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center rounded",
                        celula,
                        v.classe,
                        prob === "erro" && "ring-2 ring-perigo",
                        prob === "alerta" && "ring-2 ring-alerta",
                        marcado && "outline outline-2 outline-offset-1 outline-primary",
                      )}
                      style={v.estilo}
                    >
                      {v.curto}
                    </span>
                  );
                  return (
                    <td key={i} className={cn("border-b border-border p-0.5 text-center", fundoDia(d), d.getUTCDay() === 1 && i > 0 && "border-l border-l-border")}>
                      {aoClicar ? (
                        <button type="button" onClick={() => aoClicar(p.id, i)} aria-label={rotulo} title={rotulo} className="rounded focus-visible:outline-2 focus-visible:outline-ring">
                          {conteudo}
                        </button>
                      ) : (
                        <span title={rotulo} aria-label={rotulo}>
                          {conteudo}
                        </span>
                      )}
                    </td>
                  );
                })}
                {!compacta ? (
                  <>
                    <td className="border-b border-l border-border px-2 text-right tabular-nums">{r ? formatarHoras(r.minutosMes) : "—"}</td>
                    <td className="border-b border-border px-2 text-right tabular-nums">{r ? r.folgas : "—"}</td>
                    <td className="border-b border-border px-2 text-right tabular-nums">{r ? r.domingosFolga : "—"}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
          {config.cobertura
            .filter((k) => k.minimo.some((m) => m > 0))
            .map((k) => {
              const t = config.turnos.find((x) => x.id === k.turno);
              if (!t) return null;
              return (
                <tr key={k.turno} className="bg-muted/30">
                  <th scope="row" className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-1 text-left text-[11px] font-medium">
                    <span className="inline-block size-2 rounded-full align-middle" style={{ backgroundColor: corDoTurno(config.turnos, t.id) }} /> {t.nome}: escalados / mínimo
                  </th>
                  {dias.map((d, i) => {
                    const item = conferencia?.cobertura.find((c) => c.turno === k.turno && c.dia === i + 1);
                    const falta = item && item.escalados < item.minimo;
                    return (
                      <td key={i} className={cn("p-0.5 text-center text-[10px] tabular-nums", falta ? "font-semibold text-perigo" : "text-muted-foreground")}>
                        {item ? (item.minimo ? `${item.escalados}/${item.minimo}` : item.escalados || "") : ""}
                      </td>
                    );
                  })}
                  {!compacta ? <td colSpan={3} /> : null}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
