"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarPercentual } from "@/lib/formatos";

/**
 * Gráficos dos relatórios (recharts). As cores vêm das variáveis
 * --grafico-* do tema (claro/escuro). Os valores exibidos nas dicas são
 * formatados a partir de números com 2 casas vindos de Decimal no servidor.
 */

export type Formato = "moeda" | "numero" | "percentual";

export interface Serie {
  chave: string;
  rotulo: string;
  /** Índice da cor do tema (1 a 6). */
  cor: 1 | 2 | 3 | 4 | 5 | 6;
  /** Séries "previstas" usam a mesma cor, mais clara. */
  clara?: boolean;
}

type Ponto = Record<string, string | number | null>;

function formatar(v: unknown, formato: Formato) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (formato === "moeda") return formatarMoeda(n.toFixed(2));
  if (formato === "percentual") return formatarPercentual(n);
  return n.toLocaleString("pt-BR");
}

function formatarEixo(v: number, formato: Formato) {
  if (formato === "percentual") return `${v}%`;
  if (formato === "numero") return v.toLocaleString("pt-BR");
  const abs = Math.abs(v);
  const sinal = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sinal}${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${sinal}${abs.toLocaleString("pt-BR")}`;
}

const eixo = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;
const dica = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" },
  labelStyle: { color: "var(--titulo)", fontWeight: 600 },
  itemStyle: { color: "var(--foreground)" },
} as const;

export function GraficoBarras({
  dados,
  series,
  formato = "moeda",
  altura = 280,
  rotuloX = "rotulo",
  descricao,
  empilhado = false,
}: {
  dados: Ponto[];
  series: Serie[];
  formato?: Formato;
  altura?: number;
  rotuloX?: string;
  descricao: string;
  empilhado?: boolean;
}) {
  return (
    <div role="img" aria-label={descricao} className="w-full" style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey={rotuloX} {...eixo} />
          <YAxis {...eixo} width={64} tickFormatter={(v: number) => formatarEixo(v, formato)} />
          <ReferenceLine y={0} stroke="var(--input)" />
          <Tooltip {...dica} cursor={{ fill: "var(--muted)" }} formatter={(v) => formatar(v, formato)} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} iconType="circle" iconSize={8} /> : null}
          {series.map((s) => (
            <Bar
              key={s.chave}
              dataKey={s.chave}
              name={s.rotulo}
              fill={`var(--grafico-${s.cor})`}
              fillOpacity={s.clara ? 0.4 : 1}
              stroke={s.clara ? `var(--grafico-${s.cor})` : undefined}
              strokeWidth={s.clara ? 1 : 0}
              radius={empilhado ? 0 : [4, 4, 0, 0]}
              stackId={empilhado ? "pilha" : undefined}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GraficoLinhas({
  dados,
  series,
  formato = "moeda",
  altura = 260,
  rotuloX = "rotulo",
  descricao,
  dominio,
}: {
  dados: Ponto[];
  series: Serie[];
  formato?: Formato;
  altura?: number;
  rotuloX?: string;
  descricao: string;
  dominio?: [number, number];
}) {
  return (
    <div role="img" aria-label={descricao} className="w-full" style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey={rotuloX} {...eixo} />
          <YAxis {...eixo} width={64} domain={dominio ?? ["auto", "auto"]} tickFormatter={(v: number) => formatarEixo(v, formato)} />
          <Tooltip {...dica} cursor={{ stroke: "var(--input)" }} formatter={(v) => formatar(v, formato)} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} iconType="circle" iconSize={8} /> : null}
          {series.map((s) => (
            <Line
              key={s.chave}
              type="monotone"
              dataKey={s.chave}
              name={s.rotulo}
              stroke={`var(--grafico-${s.cor})`}
              strokeWidth={2}
              strokeDasharray={s.clara ? "5 4" : undefined}
              dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
