"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Gaveta } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import {
  ETAPAS_MAPA,
  PESO_SITUACAO,
  PESO_STATUS,
  SITUACOES_MAPA,
  STATUS_MAPA,
  diaMes,
  type ChaveEtapa,
  type EmpresaMapa,
  type SituacaoEmpresa,
  type StatusEtapa,
} from "@/lib/operacional/mapa";
import { formatarDocumento } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { BotaoAcaoEtapa, MarcacaoEtapa } from "./controles-etapa";
import { CLASSE_MARCA_SITUACAO, CLASSE_PRAZO, CLASSE_SITUACAO, CLASSE_STATUS, IconeStatus } from "./visual";

type Filtro = "todas" | SituacaoEmpresa;
type Ordem = "urgencia" | "nome" | "responsavel";

const CARTOES: { chave: Filtro; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas as empresas" },
  { chave: "fechado", rotulo: "Mês fechado" },
  { chave: "emdia", rotulo: "Em dia" },
  { chave: "perto", rotulo: "Perto do prazo" },
  { chave: "atraso", rotulo: "Com atraso" },
  { chave: "cliente", rotulo: "Esperando o cliente" },
];

const COLUNAS = "grid-cols-[minmax(240px,1.6fr)_repeat(6,minmax(112px,1fr))_minmax(104px,0.8fr)_minmax(128px,0.9fr)]";

function iniciais(nome: string | null) {
  if (!nome) return "—";
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function Avatar({ nome, className }: { nome: string | null; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground", className)}>
      {iniciais(nome)}
    </span>
  );
}

function Celula({ status, texto, titulo, selecionada, aoClicar, compacta = false }: {
  status: StatusEtapa;
  texto: string;
  titulo: string;
  selecionada: boolean;
  aoClicar: () => void;
  compacta?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      title={titulo}
      aria-label={titulo}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-lg border text-left font-semibold leading-tight transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        compacta ? "min-h-9 px-1.5 py-1 text-[11px]" : "min-h-11 px-2 py-1.5 text-xs",
        CLASSE_STATUS[status],
        selecionada && "outline-3 outline-offset-2 outline-primary",
      )}
    >
      <IconeStatus status={status} />
      <span>{texto}</span>
    </button>
  );
}

export function MapaCarteira({ competencia, empresas, usuarioId }: { competencia: string; empresas: EmpresaMapa[]; usuarioId: string }) {
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [responsavel, setResponsavel] = React.useState<string>("todos");
  const [regime, setRegime] = React.useState("todos");
  const [busca, setBusca] = React.useState("");
  const [ordem, setOrdem] = React.useState<Ordem>("urgencia");
  const [sel, setSel] = React.useState<{ empresaId: string; etapa: ChaveEtapa } | null>(null);

  const responsaveis = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const e of empresas) if (e.responsavelId) m.set(e.responsavelId, e.responsavel ?? "Sem nome");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [empresas]);
  const regimes = React.useMemo(() => [...new Set(empresas.map((e) => e.regime).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [empresas]);
  const minhas = empresas.filter((e) => e.responsavelId === usuarioId).length;

  const termo = busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const base = empresas.filter(
    (e) =>
      (responsavel === "todos" || (responsavel === "sem" ? !e.responsavelId : e.responsavelId === responsavel)) &&
      (regime === "todos" || e.regime === regime) &&
      (!termo || e.nome.toLowerCase().includes(termo) || e.razaoSocial.toLowerCase().includes(termo) || (digitos.length >= 3 && e.documento.includes(digitos))),
  );
  const linhas = base
    .filter((e) => filtro === "todas" || e.situacao === filtro)
    .sort((a, b) => {
      if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      if (ordem === "responsavel") return (a.responsavel ?? "~").localeCompare(b.responsavel ?? "~", "pt-BR") || PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao];
      return PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao] || a.nome.localeCompare(b.nome, "pt-BR");
    });
  const conta = (f: Filtro) => (f === "todas" ? base.length : base.filter((e) => e.situacao === f).length);

  // Quantas empresas já terminaram cada etapa; a mais atrasada (sem o fechamento) é o gargalo
  const colunas = ETAPAS_MAPA.map((et, j) => {
    const prontas = base.filter((e) => e.etapas[j].status === "ok" || e.etapas[j].status === "na").length;
    return { ...et, prontas, pct: base.length ? Math.round((prontas * 100) / base.length) : 0 };
  });
  let gargalo = -1;
  colunas.slice(0, 5).forEach((c, j) => {
    if (base.length && c.prontas < base.length && (gargalo < 0 || c.prontas < colunas[gargalo].prontas)) gargalo = j;
  });

  const urgentes = base
    .flatMap((e) => e.etapas.filter((et) => PESO_STATUS[et.status] !== undefined).map((et) => ({ empresa: e, etapa: et })))
    .sort((a, b) => (PESO_STATUS[a.etapa.status] ?? 9) - (PESO_STATUS[b.etapa.status] ?? 9) || (a.etapa.prazo ?? "9").localeCompare(b.etapa.prazo ?? "9"));
  const atencao = urgentes.slice(0, 4);

  const equipe = React.useMemo(() => {
    const grupos = new Map<string, { nome: string; empresas: EmpresaMapa[] }>();
    for (const e of empresas) {
      const k = e.responsavelId ?? "sem";
      const g = grupos.get(k) ?? { nome: e.responsavel ?? "Sem responsável", empresas: [] };
      g.empresas.push(e);
      grupos.set(k, g);
    }
    return [...grupos.entries()]
      .map(([id, g]) => {
        const total = g.empresas.reduce((s, e) => s + e.total, 0);
        const feitas = g.empresas.reduce((s, e) => s + e.feitas, 0);
        return { id, nome: g.nome, qtd: g.empresas.length, atrasos: g.empresas.filter((e) => e.situacao === "atraso").length, total, feitas, pct: total ? Math.round((feitas * 100) / total) : 0 };
      })
      .sort((a, b) => (a.id === "sem" ? 1 : b.id === "sem" ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
  }, [empresas]);

  const selEmpresa = sel ? empresas.find((e) => e.id === sel.empresaId) : undefined;
  const selEtapa = selEmpresa?.etapas.find((e) => e.chave === sel?.etapa);
  const abrir = (empresaId: string, etapa: ChaveEtapa) => setSel({ empresaId, etapa });
  const limpar = () => {
    setFiltro("todas");
    setResponsavel("todos");
    setRegime("todos");
    setBusca("");
    setOrdem("urgencia");
  };

  if (!empresas.length) {
    return <EstadoVazio titulo="Nenhuma empresa para mostrar" descricao="O mapa mostra as empresas ativas que você atende. Peça ao administrador para vincular você às empresas." />;
  }

  return (
    <div className="space-y-5">
      {/* Atenção agora */}
      <section aria-labelledby="atencao-titulo" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="atencao-titulo" className="font-titulo text-lg font-semibold text-titulo">
            Atenção agora
          </h2>
          {urgentes.length ? (
            <span className="text-sm text-muted-foreground">
              {urgentes.length} {urgentes.length === 1 ? "etapa pede atenção" : "etapas pedem atenção"}
              {urgentes.length > atencao.length ? " · mostrando as 4 mais urgentes" : ""}
            </span>
          ) : null}
        </div>
        {atencao.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {atencao.map(({ empresa, etapa }) => (
              <div key={`${empresa.id}-${etapa.chave}`} className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", CLASSE_STATUS[etapa.status])}>
                    <IconeStatus status={etapa.status} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-titulo">{empresa.nome}</p>
                    <p className="text-xs font-semibold text-muted-foreground">
                      {etapa.nome} · {STATUS_MAPA[etapa.status]}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{etapa.detalhe}</p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">{empresa.responsavel ?? "Sem responsável"}</span>
                  <Button tamanho="sm" onClick={() => abrir(empresa.id, etapa.chave)}>
                    Resolver
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-sucesso-bg px-4 py-3 text-sm font-semibold text-sucesso-fg">
            <Check className="size-4" aria-hidden /> Nada urgente com esses filtros.
          </p>
        )}
      </section>

      {/* Resumo (também filtra) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {CARTOES.map((c) => (
          <button
            key={c.chave}
            type="button"
            onClick={() => setFiltro(c.chave)}
            aria-pressed={filtro === c.chave}
            className={cn(
              "flex min-h-[88px] flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3.5 text-left transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              filtro === c.chave && "ring-2 ring-primary",
            )}
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span aria-hidden className={cn("size-2.5 rounded-[3px] border", CLASSE_MARCA_SITUACAO[c.chave])} />
              {c.rotulo}
            </span>
            <span className="font-titulo text-3xl font-semibold leading-none text-titulo numero">{conta(c.chave)}</span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3.5">
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Ver</span>
          <div role="group" aria-label="Quais empresas ver" className="flex gap-1 rounded-lg border border-border bg-muted p-1">
            <button
              type="button"
              aria-pressed={responsavel === "todos"}
              onClick={() => setResponsavel("todos")}
              className={cn("h-9 rounded-md px-3 text-sm font-semibold", responsavel === "todos" ? "bg-card text-titulo shadow-sm" : "text-muted-foreground")}
            >
              Toda a carteira
            </button>
            <button
              type="button"
              aria-pressed={responsavel === usuarioId}
              onClick={() => setResponsavel(usuarioId)}
              className={cn("h-9 rounded-md px-3 text-sm font-semibold", responsavel === usuarioId ? "bg-card text-titulo shadow-sm" : "text-muted-foreground")}
            >
              Minhas empresas · {minhas}
            </button>
          </div>
        </div>
        <div className="min-w-[200px] flex-[2_1_220px] space-y-1.5">
          <Label htmlFor="mapa-busca">Buscar empresa</Label>
          <Input id="mapa-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou CNPJ" autoComplete="off" />
        </div>
        <div className="min-w-[160px] flex-[1_1_160px] space-y-1.5">
          <Label htmlFor="mapa-resp">Responsável</Label>
          <Select id="mapa-resp" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="todos">Todos</option>
            {responsaveis.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
                {id === usuarioId ? " (você)" : ""}
              </option>
            ))}
            <option value="sem">Sem responsável</option>
          </Select>
        </div>
        <div className="min-w-[150px] flex-[1_1_150px] space-y-1.5">
          <Label htmlFor="mapa-regime">Regime</Label>
          <Select id="mapa-regime" value={regime} onChange={(e) => setRegime(e.target.value)}>
            <option value="todos">Todos</option>
            {regimes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[180px] flex-[1_1_180px] space-y-1.5">
          <Label htmlFor="mapa-ordem">Ordenar</Label>
          <Select id="mapa-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
            <option value="urgencia">Mais urgentes primeiro</option>
            <option value="nome">Nome da empresa</option>
            <option value="responsavel">Responsável</option>
          </Select>
        </div>
        <Button variante="contorno" onClick={limpar}>
          Limpar filtros
        </Button>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="font-semibold">O que cada cor quer dizer:</span>
        {(Object.keys(STATUS_MAPA) as StatusEtapa[]).map((s) => (
          <span key={s} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold", CLASSE_STATUS[s])}>
            <IconeStatus status={s} />
            {STATUS_MAPA[s]}
          </span>
        ))}
      </div>

      {/* Tabela (computador) */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div className="overflow-x-auto">
          <div className="min-w-[1240px]">
            <div className={cn("grid items-end gap-2 border-b border-border bg-muted/60 py-3 pr-4 text-xs font-semibold leading-tight text-muted-foreground", COLUNAS)}>
              <span className="sticky left-0 z-[2] flex self-stretch items-end bg-muted pl-4">Empresa</span>
              {colunas.map((c, j) => (
                <div key={c.chave} className="space-y-1.5">
                  <span className="block">{c.nome}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <div className={cn("h-full rounded-full", j === gargalo ? "bg-alerta" : "bg-sucesso")} style={{ width: `${c.pct}%` }} />
                    </div>
                    <span className="text-[11px] font-bold text-foreground numero">
                      {c.prontas}/{base.length}
                    </span>
                  </div>
                  {j === gargalo ? <span className="inline-block rounded bg-alerta-bg px-1.5 py-0.5 text-[11px] font-bold text-alerta-fg">Gargalo do mês</span> : null}
                </div>
              ))}
              <span>Andamento</span>
              <span>Próximo prazo</span>
            </div>
            {linhas.map((e) => (
              <div key={e.id} className={cn("grid items-center gap-2 border-b border-border/60 py-2.5 pr-4 last:border-b-0", COLUNAS)}>
                <div className="sticky left-0 z-[1] flex min-w-0 self-stretch items-center gap-3 bg-card pl-4">
                  <Avatar nome={e.responsavel} />
                  <div className="min-w-0 space-y-0.5">
                    <Link href={`/escritorio/mapa/${e.id}?competencia=${competencia.slice(0, 7)}`} className="block truncate text-sm font-semibold text-titulo hover:underline">
                      {e.nome}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.regime || "Regime não informado"} · {e.responsavel ?? "Sem responsável"}
                    </p>
                    <span className={cn("inline-block rounded-full px-2 py-px text-[11px] font-bold", CLASSE_SITUACAO[e.situacao])}>{SITUACOES_MAPA[e.situacao]}</span>
                  </div>
                </div>
                {e.etapas.map((et) => (
                  <Celula
                    key={et.chave}
                    status={et.status}
                    texto={et.texto}
                    titulo={`${e.nome} — ${et.nome}: ${STATUS_MAPA[et.status]} (${et.texto})`}
                    selecionada={sel?.empresaId === e.id && sel.etapa === et.chave}
                    aoClicar={() => abrir(e.id, et.chave)}
                  />
                ))}
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    {e.feitas} de {e.total} etapas
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-sucesso" style={{ width: `${e.total ? Math.round((e.feitas * 100) / e.total) : 100}%` }} />
                  </div>
                </div>
                <div className="space-y-0.5">
                  <span className={cn("block text-sm font-bold numero", e.prazo ? CLASSE_PRAZO[e.prazo.tom] : "text-muted-foreground")}>{e.prazo ? diaMes(e.prazo.data) : "—"}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{e.prazo?.oque ?? "Nada pendente"}</span>
                </div>
              </div>
            ))}
            {!linhas.length ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nenhuma empresa com esses filtros.{" "}
                <button type="button" onClick={limpar} className="font-semibold text-primary underline-offset-2 hover:underline">
                  Limpar filtros
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Cartões (celular) */}
      <div className="space-y-3 md:hidden">
        {linhas.map((e) => (
          <div key={e.id} className="space-y-2.5 rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Link href={`/escritorio/mapa/${e.id}?competencia=${competencia.slice(0, 7)}`} className="block text-[15px] font-semibold text-titulo">
                  {e.nome}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {e.regime || "Regime não informado"} · {e.responsavel ?? "Sem responsável"}
                </p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", CLASSE_SITUACAO[e.situacao])}>{SITUACOES_MAPA[e.situacao]}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {e.etapas.map((et) => (
                <Celula
                  key={et.chave}
                  compacta
                  status={et.status}
                  texto={et.curto}
                  titulo={`${e.nome} — ${et.nome}: ${STATUS_MAPA[et.status]} (${et.texto})`}
                  selecionada={sel?.empresaId === e.id && sel.etapa === et.chave}
                  aoClicar={() => abrir(e.id, et.chave)}
                />
              ))}
            </div>
            <p className={cn("text-xs font-semibold", e.prazo ? CLASSE_PRAZO[e.prazo.tom] : "text-muted-foreground")}>
              {e.prazo ? `Próximo prazo: ${diaMes(e.prazo.data)} · ${e.prazo.oque}` : "Nada pendente com prazo"}
            </p>
          </div>
        ))}
        {!linhas.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma empresa com esses filtros.</p> : null}
      </div>

      {/* Andamento por pessoa */}
      <section aria-labelledby="equipe-titulo" className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 id="equipe-titulo" className="font-titulo text-lg font-semibold text-titulo">
            Andamento por pessoa
          </h2>
          <p className="text-sm text-muted-foreground">Etapas concluídas no mês, somando as empresas de cada responsável.</p>
        </div>
        {equipe.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex min-w-[200px] flex-[0_1_280px] items-center gap-3">
              <Avatar nome={p.id === "sem" ? null : p.nome} />
              <div>
                <p className="text-sm font-semibold text-titulo">{p.nome}</p>
                <p className={cn("text-xs", p.atrasos ? "text-perigo" : "text-muted-foreground")}>
                  {p.qtd} {p.qtd === 1 ? "empresa" : "empresas"} · {p.atrasos ? `${p.atrasos} com atraso` : "nenhuma com atraso"}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-[999_1_320px] items-center gap-3">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${p.pct}%` }} />
              </div>
              <span className="w-32 shrink-0 text-sm font-semibold text-foreground numero">
                {p.feitas} de {p.total} etapas
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* Painel lateral da etapa */}
      <Gaveta aberto={!!(selEmpresa && selEtapa)} aoMudar={(v) => !v && setSel(null)} titulo={selEmpresa && selEtapa ? `${selEmpresa.nome} — ${selEtapa.nome}` : "Etapa"} lado="direita" className="w-[92vw] max-w-md bg-card">
        {selEmpresa && selEtapa ? (
          <div className="flex min-h-full flex-col">
            <div className="flex items-start gap-3 border-b border-border p-5">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-bold text-primary">
                  Etapa {ETAPAS_MAPA.findIndex((x) => x.chave === selEtapa.chave) + 1} de 6 · {selEtapa.nome}
                </p>
                <p className="font-titulo text-xl font-semibold text-titulo">{selEmpresa.nome}</p>
                <p className="text-sm text-muted-foreground">
                  {selEmpresa.regime || "Regime não informado"} · Responsável: {selEmpresa.responsavel ?? "ninguém"}
                </p>
              </div>
              <Button variante="contorno" className="size-11 p-0" aria-label="Fechar o painel" onClick={() => setSel(null)}>
                <X />
              </Button>
            </div>
            <div className="flex flex-1 flex-col gap-5 p-5">
              <div className={cn("space-y-2 rounded-xl border p-4", CLASSE_STATUS[selEtapa.status])}>
                <p className="flex items-center gap-2 text-sm font-bold">
                  <IconeStatus status={selEtapa.status} className="size-4" />
                  {STATUS_MAPA[selEtapa.status]} · {selEtapa.texto}
                </p>
                <p className="text-sm leading-relaxed">{selEtapa.detalhe}</p>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-bold tracking-wide text-muted-foreground">O QUE FAZER AGORA</p>
                <div className="flex flex-col gap-2">
                  {selEtapa.acao ? <BotaoAcaoEtapa acao={selEtapa.acao} empresaId={selEmpresa.id} competencia={competencia} /> : null}
                  {selEtapa.acaoSecundaria ? <BotaoAcaoEtapa acao={selEtapa.acaoSecundaria} empresaId={selEmpresa.id} competencia={competencia} principal={false} /> : null}
                </div>
                <MarcacaoEtapa etapa={selEtapa} empresaId={selEmpresa.id} competencia={competencia} />
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-bold tracking-wide text-muted-foreground">AS 6 ETAPAS DESTA EMPRESA</p>
                <div className="grid grid-cols-3 gap-2">
                  {selEmpresa.etapas.map((et) => (
                    <Celula
                      key={et.chave}
                      compacta
                      status={et.status}
                      texto={et.curto}
                      titulo={`${et.nome}: ${STATUS_MAPA[et.status]} (${et.texto})`}
                      selecionada={et.chave === selEtapa.chave}
                      aoClicar={() => abrir(selEmpresa.id, et.chave)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">Próximo prazo da empresa</p>
                <p className={cn("text-[15px] font-semibold", selEmpresa.prazo ? CLASSE_PRAZO[selEmpresa.prazo.tom] : "text-titulo")}>
                  {selEmpresa.prazo ? `${diaMes(selEmpresa.prazo.data)} · ${selEmpresa.prazo.oque}` : "Nada pendente com prazo"}
                </p>
                <p className="text-xs text-muted-foreground">CNPJ/CPF {formatarDocumento(selEmpresa.documento)}</p>
              </div>
              <Link href={`/escritorio/mapa/${selEmpresa.id}?competencia=${competencia.slice(0, 7)}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-primary hover:underline">
                Abrir a ficha completa da empresa <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link href={`/e/${selEmpresa.id}`} className="-mt-3 inline-flex min-h-11 items-center gap-1 self-start text-sm text-muted-foreground hover:underline">
                Abrir a empresa no portal <ChevronRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        ) : null}
      </Gaveta>
    </div>
  );
}
