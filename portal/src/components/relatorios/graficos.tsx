"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, nomeMes } from "@/lib/formatos";

// Cores do tema (claro e escuro), lidas das variáveis de globals.css
const CORES = {
  receita: "var(--sucesso)",
  gasto: "var(--perigo)",
  resultado: "var(--primary)",
  saldo: "var(--info)",
  grade: "var(--border)",
  texto: "var(--muted-foreground)",
};
const PALETA = ["var(--grafico-1)", "var(--grafico-2)", "var(--grafico-3)", "var(--grafico-5)", "var(--grafico-4)", "var(--grafico-6)", "var(--info)"];
const ESTILO_DICA = {
  borderRadius: 12,
  fontSize: 12,
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  boxShadow: "var(--sombra-card)",
};
const ESTILO_ROTULO_DICA = { color: "var(--titulo)", fontWeight: 600 };

const mesCurto = (m: string) => `${nomeMes(Number(m.slice(5, 7)), true)}/${m.slice(2, 4)}`;
const compacto = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} mi` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v));

/** Identificador seguro para os degradês do SVG (um por gráfico na página). */
function useIdGrafico() {
  return `g${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Degradê vertical de uma cor do tema (forte em cima, suave embaixo). */
function Degrade({ id, cor, de = 0.95, ate = 0.35 }: { id: string; cor: string; de?: number; ate?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" style={{ stopColor: cor, stopOpacity: de }} />
      <stop offset="100%" style={{ stopColor: cor, stopOpacity: ate }} />
    </linearGradient>
  );
}

function Caixa({ titulo, descricao, children, altura = 260 }: { titulo: string; descricao?: string; children: React.ReactElement; altura?: number }) {
  return (
    <figure className="rounded-2xl border border-border bg-card p-4 shadow-[var(--sombra-card)]">
      <figcaption className="mb-3">
        <p className="font-titulo text-sm font-semibold text-titulo">{titulo}</p>
        {descricao ? <p className="text-xs text-muted-foreground">{descricao}</p> : null}
      </figcaption>
      <div style={{ width: "100%", height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Receitas × gastos por mês, com a linha do resultado. */
export function GraficoEvolucao({ dados }: { dados: { mes: string; receita: number; gastos: number; resultado: number }[] }) {
  const id = useIdGrafico();
  return (
    <Caixa titulo="Receitas, gastos e resultado por mês" descricao="Pela competência (mês em que a venda ou a despesa aconteceu).">
      <ComposedChart data={dados.map((d) => ({ ...d, rotulo: mesCurto(d.mes) }))} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <Degrade id={`${id}-receita`} cor={CORES.receita} />
          <Degrade id={`${id}-gasto`} cor={CORES.gasto} />
        </defs>
        <CartesianGrid stroke={CORES.grade} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          formatter={(v, nome) => [formatarMoeda(Number(v)), String(nome)]}
          contentStyle={ESTILO_DICA}
          labelStyle={ESTILO_ROTULO_DICA}
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={0} stroke={CORES.texto} />
        <Bar dataKey="receita" name="Receitas" fill={`url(#${id}-receita)`} radius={[8, 8, 0, 0]} maxBarSize={28} />
        <Bar dataKey="gastos" name="Gastos" fill={`url(#${id}-gasto)`} radius={[8, 8, 0, 0]} maxBarSize={28} />
        <Line dataKey="resultado" name="Resultado" stroke={CORES.resultado} strokeWidth={3} dot={{ r: 3.5, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 5 }} type="monotone" />
      </ComposedChart>
    </Caixa>
  );
}

/** Para onde foi o dinheiro: composição das despesas do período. */
export function GraficoComposicao({ dados }: { dados: { nome: string; valor: number }[] }) {
  if (!dados.length) return null;
  const total = dados.reduce((s, d) => s + d.valor, 0);
  return (
    <figure className="@container rounded-2xl border border-border bg-card p-4 shadow-[var(--sombra-card)]">
      <figcaption className="mb-3">
        <p className="font-titulo text-sm font-semibold text-titulo">Para onde foi o dinheiro</p>
        <p className="text-xs text-muted-foreground">Custos e despesas do período, por categoria.</p>
      </figcaption>
      <div className="grid items-center gap-4 @2xl:grid-cols-[180px_1fr]">
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius={52} outerRadius={80} paddingAngle={2} cornerRadius={6} stroke="var(--card)" strokeWidth={2}>
                {dados.map((_, i) => (
                  <Cell key={i} fill={PALETA[i % PALETA.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatarMoeda(Number(v))} contentStyle={ESTILO_DICA} labelStyle={ESTILO_ROTULO_DICA} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 space-y-1.5 text-sm">
          {dados.map((d, i) => (
            <li key={d.nome} className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ background: PALETA[i % PALETA.length] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{d.nome}</span>
              <span className="shrink-0 numero text-muted-foreground">{total ? `${Math.round((d.valor / total) * 100)}%` : ""}</span>
              <span className="shrink-0 whitespace-nowrap numero font-medium">{formatarMoeda(d.valor)}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

/** Saldo projetado dia a dia (próximos 90 dias). */
export function GraficoProjecao({ pontos }: { pontos: { data: string; saldo: number; entradas: number; saidas: number }[] }) {
  const id = useIdGrafico();
  const negativo = pontos.some((p) => p.saldo < 0);
  const cor = negativo ? "var(--perigo)" : CORES.saldo;
  return (
    <Caixa titulo="Previsão do saldo disponível" descricao="Saldo de hoje + contas a receber − contas a pagar, pelo vencimento.">
      <AreaChart data={pontos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <Degrade id={`${id}-saldo`} cor={cor} de={0.4} ate={0.02} />
        </defs>
        <CartesianGrid stroke={CORES.grade} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="data" tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          labelFormatter={(d) => formatarData(String(d))}
          formatter={(v, nome) => [formatarMoeda(Number(v)), nome === "saldo" ? "Saldo previsto" : String(nome)]}
          contentStyle={ESTILO_DICA}
          labelStyle={ESTILO_ROTULO_DICA}
        />
        <ReferenceLine y={0} stroke="var(--perigo)" strokeDasharray="4 4" />
        <Area type="stepAfter" dataKey="saldo" name="saldo" stroke={cor} strokeWidth={2.5} fill={`url(#${id}-saldo)`} />
      </AreaChart>
    </Caixa>
  );
}

/** Saldo de caixa ao final de cada mês. */
export function GraficoSaldoMensal({ dados }: { dados: { mes: string; saldoFinal: number }[] }) {
  const id = useIdGrafico();
  return (
    <Caixa titulo="Saldo disponível no fim de cada mês" altura={220}>
      <AreaChart data={dados.map((d) => ({ ...d, rotulo: mesCurto(d.mes) }))} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={`${id}-linha`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--grafico-1)" }} />
            <stop offset="100%" style={{ stopColor: "var(--grafico-2)" }} />
          </linearGradient>
          <Degrade id={`${id}-area`} cor="var(--grafico-2)" de={0.35} ate={0.02} />
        </defs>
        <CartesianGrid stroke={CORES.grade} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(v) => [formatarMoeda(Number(v)), "Saldo"]} contentStyle={ESTILO_DICA} labelStyle={ESTILO_ROTULO_DICA} />
        <ReferenceLine y={0} stroke={CORES.texto} />
        <Area type="monotone" dataKey="saldoFinal" stroke={`url(#${id}-linha)`} strokeWidth={3} fill={`url(#${id}-area)`} />
      </AreaChart>
    </Caixa>
  );
}
