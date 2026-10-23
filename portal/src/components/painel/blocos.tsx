import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças do painel em blocos (visão geral da empresa e do escritório): cartões
 * de tamanhos diferentes, um em destaque com a cor do portal, medidor em arco,
 * barras do mês e a faixa da semana. Tudo usa as cores do tema (Luz, Aurora e
 * Bronze).
 */

export function GradeBlocos({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-flow-row-dense gap-4 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0", className)}>{children}</div>;
}

export function Bloco({
  titulo,
  acao,
  href,
  rotuloLink,
  destaque = false,
  largura = 1,
  className,
  children,
}: {
  titulo: React.ReactNode;
  /** Elemento à direita do título (selo, contador...). */
  acao?: React.ReactNode;
  /** Atalho no canto do bloco para a tela completa. */
  href?: string;
  rotuloLink?: string;
  destaque?: boolean;
  /** Colunas ocupadas no computador (1 a 4). */
  largura?: 1 | 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
}) {
  const colunas = { 1: "", 2: "md:col-span-2", 3: "md:col-span-2 xl:col-span-3", 4: "md:col-span-2 xl:col-span-4" }[largura];
  return (
    <section
      className={cn(
        "bloco-sobe flex flex-col gap-3 rounded-3xl p-5",
        destaque ? "bg-primary text-primary-foreground shadow-[var(--brilho)]" : "border border-border bg-card text-card-foreground shadow-[var(--sombra-card)]",
        colunas,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn("text-base font-semibold leading-tight", destaque ? "text-primary-foreground" : "text-titulo")}>{titulo}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {acao}
          {href ? (
            <Link
              href={href}
              aria-label={rotuloLink ?? `Abrir ${typeof titulo === "string" ? titulo.toLowerCase() : "a tela"}`}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-full border transition-colors",
                destaque ? "border-primary-foreground/40 hover:bg-primary-foreground/15" : "border-border text-foreground hover:border-primary/40 hover:text-primary",
              )}
            >
              <ArrowUpRight className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Selo pequeno (ex.: "+12%", "2 novas"). */
export function Selo({ tom = "neutro", children }: { tom?: "neutro" | "sucesso" | "alerta" | "perigo" | "info" | "claro"; children: React.ReactNode }) {
  const cores = {
    neutro: "bg-secondary text-primary",
    sucesso: "bg-sucesso-bg text-sucesso-fg",
    alerta: "bg-alerta-bg text-alerta-fg",
    perigo: "bg-perigo-bg text-perigo-fg",
    info: "bg-info-bg text-info-fg",
    claro: "bg-primary-foreground/18 text-primary-foreground",
  };
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", cores[tom])}>{children}</span>;
}

/** Número grande do topo do painel, com o rótulo em cima e um selo ao lado. */
export function Estatistica({ rotulo, valor, selo, href }: { rotulo: string; valor: React.ReactNode; selo?: React.ReactNode; href?: string }) {
  const corpo = (
    <>
      <span className="block text-sm text-muted-foreground">{rotulo}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-titulo text-2xl font-semibold tracking-tight text-titulo sm:text-3xl">{valor}</span>
        {selo}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl transition-opacity hover:opacity-80">
      {corpo}
    </Link>
  ) : (
    <div>{corpo}</div>
  );
}

const ARCO = 270.2;

/** Medidor em arco (0 a 100%), com o número no meio. */
export function Medidor({ percentual, legenda, rotulo }: { percentual: number | null; legenda: React.ReactNode; rotulo: string }) {
  const v = percentual == null ? 0 : Math.max(0, Math.min(100, percentual));
  return (
    <div className="relative h-[130px] w-[220px] shrink-0">
      <svg role="img" aria-label={rotulo} width="220" height="130" viewBox="0 0 220 130">
        <path d="M24 112 A86 86 0 0 1 196 112" fill="none" stroke="var(--muted)" strokeWidth="18" strokeLinecap="round" />
        {v > 0 ? (
          <path
            className="medidor-enche"
            d="M24 112 A86 86 0 0 1 196 112"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={ARCO}
            strokeDashoffset={(ARCO * (1 - v / 100)).toFixed(1)}
          />
        ) : null}
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="font-titulo text-3xl font-semibold text-titulo">{percentual == null ? "—" : `${Math.round(v)}%`}</div>
        <div className="text-xs text-muted-foreground">{legenda}</div>
      </div>
    </div>
  );
}

/** Barras por mês: o último (mês de trabalho) em destaque com o valor em cima. */
export function BarrasMeses({
  meses,
  rotuloDestaque,
  descricao,
}: {
  meses: { rotulo: string; valor: number }[];
  rotuloDestaque: string;
  /** Texto para leitores de tela (o gráfico inteiro em uma frase). */
  descricao: string;
}) {
  const maximo = Math.max(...meses.map((m) => m.valor), 1);
  const ALTURA = 150;
  return (
    <div>
      <div role="img" aria-label={descricao} className="grid h-[190px] items-end gap-1.5 border-b border-border pt-7 sm:gap-2" style={{ gridTemplateColumns: `repeat(${meses.length}, minmax(0, 1fr))` }}>
        {meses.map((m, i) => {
          const atual = i === meses.length - 1;
          const altura = Math.max(m.valor > 0 ? 4 : 2, Math.round((m.valor / maximo) * ALTURA));
          return (
            <div key={m.rotulo + i} className="relative flex h-full items-end">
              {atual ? (
                <span
                  className="absolute right-0 z-10 -translate-y-full whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background"
                  style={{ top: `calc(100% - ${altura + 6}px)` }}
                >
                  {rotuloDestaque}
                </span>
              ) : null}
              <div
                className={cn("barra-cresce w-full rounded-t-[10px] rounded-b-[4px]", atual ? "bg-primary" : "bg-muted-foreground/20")}
                style={{ height: altura, animationDelay: `${i * 40}ms` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid gap-1.5 text-center text-[11px] text-muted-foreground sm:gap-2" style={{ gridTemplateColumns: `repeat(${meses.length}, minmax(0, 1fr))` }}>
        {meses.map((m, i) => (
          <span key={m.rotulo + i}>{m.rotulo}</span>
        ))}
      </div>
    </div>
  );
}

export interface DiaSemana {
  data: string;
  /** Rótulo curto do dia ("seg", "ter"...). */
  dia: string;
  numero: number;
  hoje: boolean;
}

/** Os sete dias (segunda a domingo) da semana de uma data AAAA-MM-DD. */
export function diasDaSemana(hoje: string): DiaSemana[] {
  const NOMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const base = new Date(`${hoje}T12:00:00Z`);
  const desdeSegunda = (base.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - desdeSegunda + i);
    const iso = d.toISOString().slice(0, 10);
    return { data: iso, dia: NOMES[d.getUTCDay()], numero: d.getUTCDate(), hoje: iso === hoje };
  });
}

/** Cabeçalho de um dia da semana: nome e número num círculo (hoje em destaque). */
export function CabecaDia({ dia }: { dia: DiaSemana }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{dia.dia}</span>
      <span
        aria-current={dia.hoje ? "date" : undefined}
        className={cn("flex size-11 items-center justify-center rounded-full font-semibold", dia.hoje ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}
      >
        {dia.numero}
      </span>
    </div>
  );
}

/** Linha "rótulo ............ valor" com um ponto colorido, como link. */
export function LinhaContagem({ href, rotulo, valor, tom }: { href: string; rotulo: string; valor: React.ReactNode; tom: "sucesso" | "alerta" | "perigo" | "info" | "neutro" }) {
  const ponto = { sucesso: "bg-sucesso", alerta: "bg-alerta", perigo: "bg-perigo", info: "bg-info", neutro: "bg-primary" }[tom];
  return (
    <Link href={href} className="flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 text-sm transition-colors hover:bg-muted">
      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", ponto)} />
      <span className="min-w-0 flex-1 truncate">{rotulo}</span>
      <strong className="numero">{valor}</strong>
    </Link>
  );
}
