"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatarMoeda } from "@/lib/dinheiro";

const ESTILO_DICA = {
  borderRadius: 12,
  fontSize: 12,
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)",
  boxShadow: "var(--sombra-card)",
};
const TEXTO = "var(--muted-foreground)";
const GRADE = "var(--border)";
const compacto = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} mi` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v));

function Caixa({ titulo, descricao, children, altura = 280 }: { titulo: string; descricao?: string; children: React.ReactElement; altura?: number }) {
  return (
    <figure className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--sombra-card)]">
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

export interface DegrauCascata {
  nome: string;
  valor: number;
  tipo: "inicio" | "saida" | "fim";
}

/** Barras da cascata: base invisível + o tamanho de cada degrau. */
function montarCascata(degraus: DegrauCascata[]) {
  let acumulado = 0;
  return degraus.map((d) => {
    if (d.tipo === "inicio") {
      acumulado = d.valor;
      return { nome: d.nome, base: 0, barra: d.valor, valor: d.valor, cor: "var(--info)" };
    }
    if (d.tipo === "fim") {
      return { nome: d.nome, base: Math.min(0, d.valor), barra: Math.abs(d.valor), valor: d.valor, cor: d.valor >= 0 ? "var(--sucesso)" : "var(--perigo)" };
    }
    const topo = acumulado;
    acumulado -= d.valor;
    return { nome: d.nome, base: Math.min(topo, acumulado), barra: Math.abs(d.valor), valor: -d.valor, cor: "var(--alerta)" };
  });
}

/** Do frete ao lucro: cada degrau mostra quanto saiu do dinheiro do frete. */
export function GraficoCascata({ degraus }: { degraus: DegrauCascata[] }) {
  const dados = montarCascata(degraus);
  return (
    <Caixa titulo="Do frete ao lucro" descricao="Barra azul: o que entrou. Laranja: o que saiu. Verde: o que sobrou de verdade (vermelho se faltou).">
      <BarChart data={dados} margin={{ top: 20, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRADE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="nome" tick={{ fontSize: 11, fill: TEXTO }} tickLine={false} axisLine={false} interval={0} />
        <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: TEXTO }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          contentStyle={ESTILO_DICA}
          formatter={(_v, nome, item) => (nome === "barra" ? [formatarMoeda((item.payload as { valor: number }).valor), "Valor"] : null)}
        />
        <ReferenceLine y={0} stroke={TEXTO} />
        <Bar dataKey="base" stackId="c" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="barra" stackId="c" radius={[6, 6, 6, 6]} maxBarSize={56}>
          {dados.map((d, i) => (
            <Cell key={i} fill={d.cor} />
          ))}
          <LabelList dataKey="valor" position="top" formatter={(v) => compacto(Number(v))} style={{ fontSize: 11, fill: "var(--foreground)" }} />
        </Bar>
      </BarChart>
    </Caixa>
  );
}

/** Média km/l de cada abastecimento, com a faixa normal destacada. */
export function GraficoConsumo({ pontos, minimo, maximo }: { pontos: { data: string; media: number }[]; minimo: number; maximo: number }) {
  if (pontos.length < 2) return null;
  const dados = pontos.map((p) => ({ ...p, rotulo: `${p.data.slice(8, 10)}/${p.data.slice(5, 7)}` }));
  const topo = Math.max(maximo + 0.5, ...dados.map((d) => d.media));
  return (
    <Caixa titulo="Consumo em cada abastecimento (km/l)" descricao="A faixa verde é o normal para caminhão. Ponto vermelho: confira o km ou os litros daquele lançamento." altura={240}>
      <LineChart data={dados} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRADE} strokeDasharray="3 3" vertical={false} />
        <ReferenceArea y1={minimo} y2={maximo} fill="var(--sucesso)" fillOpacity={0.08} />
        <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: TEXTO }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, Math.ceil(topo)]} tick={{ fontSize: 11, fill: TEXTO }} tickLine={false} axisLine={false} width={32} />
        <Tooltip contentStyle={ESTILO_DICA} formatter={(v) => [`${Number(v).toLocaleString("pt-BR")} km/l`, "Média"]} />
        <Line
          type="monotone"
          dataKey="media"
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={(p) => {
            const fora = p.payload.media < minimo || p.payload.media > maximo;
            return <circle key={p.index} cx={p.cx} cy={p.cy} r={fora ? 6 : 4} fill={fora ? "var(--perigo)" : "var(--card)"} stroke={fora ? "var(--perigo)" : "var(--primary)"} strokeWidth={2} />;
          }}
        />
      </LineChart>
    </Caixa>
  );
}

/** Lucro de verdade de cada caminhão (do melhor para o pior). */
export function GraficoRanking({ dados }: { dados: { placa: string; lucro: number }[] }) {
  if (!dados.length) return null;
  return (
    <Caixa titulo="Lucro de verdade por caminhão" descricao="Do que mais deu lucro para o que menos deu." altura={Math.max(160, dados.length * 46 + 40)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRADE} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={compacto} tick={{ fontSize: 11, fill: TEXTO }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="placa" tick={{ fontSize: 12, fill: "var(--foreground)" }} tickLine={false} axisLine={false} width={72} />
        <Tooltip contentStyle={ESTILO_DICA} formatter={(v) => [formatarMoeda(Number(v)), "Lucro"]} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
        <ReferenceLine x={0} stroke={TEXTO} />
        <Bar dataKey="lucro" radius={[6, 6, 6, 6]} maxBarSize={28}>
          {dados.map((d, i) => (
            <Cell key={i} fill={d.lucro >= 0 ? "var(--sucesso)" : "var(--perigo)"} />
          ))}
        </Bar>
      </BarChart>
    </Caixa>
  );
}
