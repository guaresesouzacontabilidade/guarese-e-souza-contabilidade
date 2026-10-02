"use client";

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

const CORES = {
  receita: "var(--sucesso)",
  gasto: "var(--perigo)",
  resultado: "var(--primary)",
  saldo: "var(--info)",
  grade: "var(--border)",
  texto: "var(--muted-foreground)",
};
const PALETA = ["#4a2c1d", "#a16207", "#1d4ed8", "#15803d", "#b91c1c", "#7c3aed", "#9ca3af"];

const mesCurto = (m: string) => `${nomeMes(Number(m.slice(5, 7)), true)}/${m.slice(2, 4)}`;
const compacto = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} mi` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v));

function Caixa({ titulo, descricao, children, altura = 260 }: { titulo: string; descricao?: string; children: React.ReactElement; altura?: number }) {
  return (
    <figure className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <figcaption className="mb-3">
        <p className="text-sm font-semibold text-titulo">{titulo}</p>
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
  return (
    <Caixa titulo="Receitas, gastos e resultado por mês" descricao="Pela competência (mês em que a venda ou a despesa aconteceu).">
      <ComposedChart data={dados.map((d) => ({ ...d, rotulo: mesCurto(d.mes) }))} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={CORES.grade} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(v, nome) => [formatarMoeda(Number(v)), String(nome)]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine y={0} stroke={CORES.texto} />
        <Bar dataKey="receita" name="Receitas" fill={CORES.receita} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="gastos" name="Gastos" fill={CORES.gasto} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line dataKey="resultado" name="Resultado" stroke={CORES.resultado} strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />
      </ComposedChart>
    </Caixa>
  );
}

/** Para onde foi o dinheiro: composição das despesas do período. */
export function GraficoComposicao({ dados }: { dados: { nome: string; valor: number }[] }) {
  if (!dados.length) return null;
  const total = dados.reduce((s, d) => s + d.valor, 0);
  return (
    <figure className="@container rounded-xl border border-border bg-card p-4 shadow-sm">
      <figcaption className="mb-3">
        <p className="text-sm font-semibold text-titulo">Para onde foi o dinheiro</p>
        <p className="text-xs text-muted-foreground">Custos e despesas do período, por categoria.</p>
      </figcaption>
      <div className="grid items-center gap-4 @2xl:grid-cols-[180px_1fr]">
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius={50} outerRadius={80} paddingAngle={1} stroke="var(--card)">
                {dados.map((_, i) => (
                  <Cell key={i} fill={PALETA[i % PALETA.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatarMoeda(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 space-y-1.5 text-sm">
          {dados.map((d, i) => (
            <li key={d.nome} className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-sm" style={{ background: PALETA[i % PALETA.length] }} aria-hidden />
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
  const negativo = pontos.some((p) => p.saldo < 0);
  return (
    <Caixa titulo="Previsão do saldo disponível" descricao="Saldo de hoje + contas a receber − contas a pagar, pelo vencimento.">
      <AreaChart data={pontos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="saldoProj" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={negativo ? "#b91c1c" : "#1d4ed8"} stopOpacity={0.35} />
            <stop offset="100%" stopColor={negativo ? "#b91c1c" : "#1d4ed8"} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CORES.grade} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="data" tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          labelFormatter={(d) => formatarData(String(d))}
          formatter={(v, nome) => [formatarMoeda(Number(v)), nome === "saldo" ? "Saldo previsto" : String(nome)]}
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
        />
        <ReferenceLine y={0} stroke="#b91c1c" strokeDasharray="4 4" />
        <Area type="stepAfter" dataKey="saldo" name="saldo" stroke={negativo ? "#b91c1c" : "#1d4ed8"} strokeWidth={2} fill="url(#saldoProj)" />
      </AreaChart>
    </Caixa>
  );
}

/** Saldo de caixa ao final de cada mês. */
export function GraficoSaldoMensal({ dados }: { dados: { mes: string; saldoFinal: number }[] }) {
  return (
    <Caixa titulo="Saldo disponível no fim de cada mês" altura={220}>
      <AreaChart data={dados.map((d) => ({ ...d, rotulo: mesCurto(d.mes) }))} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={CORES.grade} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: CORES.texto }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(v) => [formatarMoeda(Number(v)), "Saldo"]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        <ReferenceLine y={0} stroke={CORES.texto} />
        <Area type="monotone" dataKey="saldoFinal" stroke="#1d4ed8" strokeWidth={2} fill="#1d4ed8" fillOpacity={0.12} />
      </AreaChart>
    </Caixa>
  );
}
