"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  Link2,
  Lock,
  Play,
  User,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { moverTarefa } from "@/lib/rh/acoes";
import {
  COLUNAS,
  PERIODICIDADE,
  PERIODICIDADES,
  REGRA,
  STATUS,
  atrasada,
  formatarPrazo,
  ordemEntre,
  rotuloPeriodo,
  type StatusTarefa,
} from "@/lib/rh/rotulos";
import type { TarefaCartao } from "@/lib/rh/dados";
import { EtiquetaPeriodicidade } from "./etiqueta";
import { BotaoConferencia } from "./tarefa";

/**
 * Quadro (Kanban) das tarefas recorrentes, no jeito da esteira das OS:
 * A fazer → Em andamento → Concluída. Arraste entre "A fazer" e "Em andamento";
 * para concluir, abra a tarefa (ela pede o que o modelo exige) ou espere o
 * registro do sistema (fechamento do caixa, conciliação, conferência).
 */
export function QuadroTarefas({
  empresaId,
  tarefas,
  funcionarios,
  cargos,
  gestor,
}: {
  empresaId: string;
  tarefas: TarefaCartao[];
  funcionarios: { id: string; nome: string }[];
  cargos: { id: string; nome: string }[];
  gestor: boolean;
}) {
  const router = useRouter();
  const [lista, setLista] = React.useState(tarefas);
  const [recebidas, setRecebidas] = React.useState(tarefas);
  if (recebidas !== tarefas) {
    setRecebidas(tarefas);
    setLista(tarefas);
  }
  const [funcionario, setFuncionario] = React.useState("");
  const [cargo, setCargo] = React.useState("");
  const [periodicidade, setPeriodicidade] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<StatusTarefa | null>(null);
  const [agora, setAgora] = React.useState(() => Date.now());

  React.useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  React.useEffect(() => {
    if (arrastando) return;
    const t = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [arrastando, router]);

  const visivel = (t: TarefaCartao) =>
    (!funcionario ||
      (funcionario === "sem"
        ? !t.responsavel_id
        : t.responsavel_id === funcionario)) &&
    (!cargo || (cargo === "sem" ? !t.cargo_id : t.cargo_id === cargo)) &&
    (!periodicidade || t.periodicidade === periodicidade) &&
    (!status ||
      (status === "atrasada" ? atrasada(t, agora) : t.status === status));
  const filtradas = lista.filter(visivel);
  const coluna = (s: StatusTarefa) =>
    filtradas
      .filter((t) => t.status === s)
      .sort((a, b) =>
        s === "concluida"
          ? (b.concluida_em ?? "").localeCompare(a.concluida_em ?? "")
          : a.ordem - b.ordem || a.prazo.localeCompare(b.prazo),
      );

  const abertas = lista.filter((t) => t.status !== "concluida");
  const atrasadasN = abertas.filter((t) => atrasada(t, agora)).length;

  async function mover(t: TarefaCartao, destino: StatusTarefa) {
    if (destino === t.status) return;
    if (destino === "concluida") {
      if (REGRA[t.regra].automatica && t.regra !== "conferencia_estoque") {
        toast.message("Esta tarefa conclui sozinha", {
          description: REGRA[t.regra].ajuda,
        });
      } else {
        router.push(`/e/${empresaId}/rh/tarefas/${t.id}#concluir`);
      }
      return;
    }
    if (t.status === "concluida") {
      toast.error(
        "Tarefa concluída não volta: o registro do período fica guardado.",
      );
      return;
    }
    const col = coluna(destino);
    const ordem = ordemEntre(
      col.length ? col[col.length - 1].ordem : null,
      null,
    );
    const antes = lista;
    setLista((ls) =>
      ls.map((x) => (x.id === t.id ? { ...x, status: destino, ordem } : x)),
    );
    const r = await moverTarefa(empresaId, t.id, destino, ordem);
    if (!r.ok) {
      setLista(antes);
      toast.error(r.mensagem ?? "Não foi possível mover a tarefa.");
    } else {
      toast.success(`${t.titulo}: ${STATUS[destino].rotulo.toLowerCase()}.`);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0"
        data-testid="rh-resumo"
      >
        <Resumo
          rotulo="A fazer"
          valor={lista.filter((t) => t.status === "a_fazer").length}
        />
        <Resumo
          rotulo="Em andamento"
          valor={lista.filter((t) => t.status === "em_andamento").length}
          tom="info"
        />
        <Resumo
          rotulo="Atrasadas"
          valor={atrasadasN}
          tom={atrasadasN ? "perigo" : "neutro"}
        />
        <Resumo
          rotulo="Concluídas (14 dias)"
          valor={lista.filter((t) => t.status === "concluida").length}
          tom="sucesso"
        />
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filtros do quadro"
      >
        {gestor ? (
          <>
            <Select
              value={funcionario}
              onChange={(e) => setFuncionario(e.target.value)}
              aria-label="Filtrar por funcionário"
              className="w-auto"
            >
              <option value="">Todos os funcionários</option>
              <option value="sem">Sem responsável</option>
              {funcionarios.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Select>
            <Select
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              aria-label="Filtrar por cargo"
              className="w-auto"
            >
              <option value="">Todos os cargos</option>
              <option value="sem">Sem cargo</option>
              {cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Select
          value={periodicidade}
          onChange={(e) => setPeriodicidade(e.target.value)}
          aria-label="Filtrar por periodicidade"
          className="w-auto"
        >
          <option value="">Todas as periodicidades</option>
          {PERIODICIDADES.map((p) => (
            <option key={p} value={p}>
              {PERIODICIDADE[p].rotulo}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filtrar por situação"
          className="w-auto"
        >
          <option value="">Todas as situações</option>
          {COLUNAS.map((s) => (
            <option key={s} value={s}>
              {STATUS[s].rotulo}
            </option>
          ))}
          <option value="atrasada">Atrasadas</option>
        </Select>
        {funcionario || cargo || periodicidade || status ? (
          <Button
            variante="fantasma"
            tamanho="sm"
            onClick={() => {
              setFuncionario("");
              setCargo("");
              setPeriodicidade("");
              setStatus("");
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
        <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
          Arraste entre “A fazer” e “Em andamento”. Para concluir, abra a
          tarefa.
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {COLUNAS.map((s) => {
          const itens = coluna(s);
          return (
            <section
              key={s}
              aria-label={STATUS[s].rotulo}
              data-coluna={s}
              onDragOver={(e) => {
                if (!arrastando) return;
                e.preventDefault();
                setAlvo(s);
              }}
              onDragLeave={() => setAlvo((a) => (a === s ? null : a))}
              onDrop={(e) => {
                e.preventDefault();
                const t = lista.find((x) => x.id === arrastando);
                setArrastando(null);
                setAlvo(null);
                if (t) void mover(t, s);
              }}
              className={cn(
                "min-h-40 rounded-2xl border border-border bg-muted/40 p-2 transition-colors",
                alvo === s && "border-primary bg-primary/5",
              )}
            >
              <h2 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-sm font-semibold">
                {STATUS[s].rotulo}
                <span className="rounded-full bg-card px-2 text-xs font-medium text-muted-foreground">
                  {itens.length}
                </span>
              </h2>
              <div className="space-y-2">
                {itens.map((t) => (
                  <Cartao
                    key={t.id}
                    t={t}
                    empresaId={empresaId}
                    agora={agora}
                    arrastando={arrastando === t.id}
                    aoArrastar={() => setArrastando(t.id)}
                    aoSoltar={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    aoComecar={() => mover(t, "em_andamento")}
                  />
                ))}
                {!itens.length ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    Nenhuma tarefa aqui.
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Resumo({
  rotulo,
  valor,
  tom = "neutro",
}: {
  rotulo: string;
  valor: number;
  tom?: "neutro" | "info" | "sucesso" | "perigo";
}) {
  const cor = {
    neutro: "text-titulo",
    info: "text-info",
    sucesso: "text-sucesso",
    perigo: "text-perigo",
  }[tom];
  return (
    <div className="min-w-[8rem] shrink-0 rounded-xl border border-border bg-card px-3 py-2 sm:min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn("text-2xl font-bold", cor)}>{valor}</p>
    </div>
  );
}

function Cartao({
  t,
  empresaId,
  agora,
  arrastando,
  aoArrastar,
  aoSoltar,
  aoComecar,
}: {
  t: TarefaCartao;
  empresaId: string;
  agora: number;
  arrastando: boolean;
  aoArrastar: () => void;
  aoSoltar: () => void;
  aoComecar: () => void;
}) {
  const atraso = atrasada(t, agora);
  const aberta = t.status !== "concluida";
  return (
    <article
      data-testid="cartao-tarefa"
      data-tarefa={t.id}
      draggable={aberta}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.id);
        aoArrastar();
      }}
      onDragEnd={aoSoltar}
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-sm transition-[opacity,transform]",
        aberta && "cursor-grab hover:-translate-y-0.5 active:cursor-grabbing",
        atraso && "border-perigo/60 ring-1 ring-perigo/40",
        arrastando && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/e/${empresaId}/rh/tarefas/${t.id}`}
          draggable={false}
          className="font-semibold leading-snug hover:underline"
        >
          {t.titulo}
        </Link>
        <EtiquetaPeriodicidade
          periodicidade={t.periodicidade}
          className="shrink-0"
        />
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {rotuloPeriodo(t.periodicidade, t.periodo_inicio, t.periodo_fim)}
      </p>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <User className="size-3.5 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Responsável</dt>
          <dd className={cn(!t.responsavel && "text-muted-foreground")}>
            {t.responsavel ?? "Sem responsável"}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <CalendarClock
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
          <dt className="sr-only">Prazo</dt>
          <dd className={cn(atraso && "font-semibold text-perigo")}>
            {aberta
              ? `Prazo ${formatarPrazo(t.prazo)}`
              : `Concluída ${t.concluida_em ? formatarPrazo(t.concluida_em) : ""}`}
            {atraso ? " · Atrasada" : ""}
          </dd>
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
        {!aberta && t.origem_conclusao ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">
            {t.origem_conclusao === "automatica"
              ? "Conclusão automática"
              : "Conclusão manual"}
          </span>
        ) : null}
        {aberta &&
        REGRA[t.regra].automatica &&
        t.regra !== "conferencia_estoque" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            <Wand2 className="size-3" aria-hidden /> Conclui sozinha
          </span>
        ) : null}
        {aberta && t.dependencias_abertas.length ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-alerta/50 bg-alerta/10 px-2 py-0.5 text-[11px]"
            title={t.dependencias_abertas.join(", ")}
          >
            <Lock className="size-3" aria-hidden /> Depende de:{" "}
            {t.dependencias_abertas[0]}
            {t.dependencias_abertas.length > 1
              ? ` +${t.dependencias_abertas.length - 1}`
              : ""}
          </span>
        ) : null}
        {t.sugestoes ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-info/50 bg-info/10 px-2 py-0.5 text-[11px]">
            <Link2 className="size-3" aria-hidden /> Registro para confirmar
          </span>
        ) : null}
        {t.progresso && t.progresso.total ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">
            {t.progresso.total - t.progresso.pendentes} de {t.progresso.total}{" "}
            movimentos conciliados
          </span>
        ) : null}
        {t.conclusao_pendente ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-alerta/50 px-2 py-0.5 text-[11px]">
            <AlertTriangle className="size-3" aria-hidden /> Registro ok,
            aguardando a etapa anterior
          </span>
        ) : null}
      </div>
      {aberta ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {t.status === "a_fazer" ? (
            <Button tamanho="sm" variante="contorno" onClick={aoComecar}>
              <Play /> Começar
            </Button>
          ) : null}
          {t.regra === "conferencia_estoque" ? (
            <BotaoConferencia empresaId={empresaId} tamanho="sm" />
          ) : !REGRA[t.regra].automatica ? (
            <Button
              asChild
              tamanho="sm"
              variante={t.status === "em_andamento" ? "primario" : "contorno"}
            >
              <Link href={`/e/${empresaId}/rh/tarefas/${t.id}#concluir`}>
                Concluir
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
