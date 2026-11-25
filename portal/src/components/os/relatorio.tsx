"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { BotaoAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { ajustarEstimativaOs } from "@/lib/os/acoes";
import { formatarMinutos } from "@/lib/os/rotulos";

const ESTILO_DICA = {
  borderRadius: 12,
  fontSize: 12,
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  boxShadow: "var(--sombra-card)",
};

/** OS abertas × concluídas por dia. */
export function GraficoDias({ dias }: { dias: { dia: string; abertas: number; concluidas: number }[] }) {
  const dados = dias.map((d) => ({ ...d, rotulo: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}` }));
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">OS abertas e concluídas por dia</figcaption>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip contentStyle={ESTILO_DICA} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="abertas" name="Abertas" fill="var(--grafico-6)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="concluidas" name="Concluídas" fill="var(--grafico-3)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Estimado × real por serviço (minutos). */
export function GraficoServicos({ linhas }: { linhas: { nome: string; minutosEstimados: number; minutosReais: number }[] }) {
  const dados = linhas.slice(0, 8).map((l) => ({ nome: l.nome.length > 22 ? `${l.nome.slice(0, 21)}…` : l.nome, Estimado: l.minutosEstimados, Real: l.minutosReais }));
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">Tempo estimado e tempo real por serviço</figcaption>
      <div style={{ width: "100%", height: Math.max(dados.length * 44 + 40, 160) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => formatarMinutos(v)} />
            <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Tooltip contentStyle={ESTILO_DICA} formatter={(v) => formatarMinutos(Number(v))} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Estimado" fill="var(--grafico-6)" radius={[0, 4, 4, 0]} />
            <Bar dataKey="Real" fill="var(--grafico-1)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function AjustarEstimativa({ empresaId, servicoId, sugestao, unidade }: { empresaId: string; servicoId: string; sugestao: number; unidade: string }) {
  return (
    <BotaoAcao tamanho="sm" variante="contorno" acao={() => ajustarEstimativaOs(empresaId, servicoId, sugestao)}>
      Ajustar para {String(sugestao).replace(".", ",")} min/{unidade}
    </BotaoAcao>
  );
}

/** Planilha (CSV) das OS concluídas no período. */
export function BaixarCsv({ linhas, nome }: { linhas: (string | number)[][]; nome: string }) {
  return (
    <Button
      variante="contorno"
      onClick={() => {
        const csv = linhas.map((l) => l.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\r\n");
        const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = nome;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download /> Planilha (CSV)
    </Button>
  );
}
