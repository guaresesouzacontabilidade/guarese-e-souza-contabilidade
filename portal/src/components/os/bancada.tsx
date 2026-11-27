"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Clock, FileText, Loader2, Pause, Play, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { atribuirOs, moverOs, pausarOs, retomarOs } from "@/lib/os/acoes";
import { andamento, ETAPA, formatarMinutos, tempoNaEtapa, type EtapaOs, type TempoOs } from "@/lib/os/rotulos";
import { DialogoEntregar } from "./entregar-os";
import { FotosOs, type FotoOs } from "./fotos-os";
import type { PessoaOs } from "./form-os";

const MOTIVOS = ["Falta de material", "Aguardando o cliente", "Máquina parada", "Intervalo"];

export interface OsBancada extends TempoOs {
  id: string;
  numero: number;
  cliente_nome: string;
  responsavel_id: string | null;
  pausa_motivo: string | null;
  descricao: string | null;
  observacoes: string | null;
  itens: { descricao: string; quantidade: number | string; unidade: string; setor: string | null }[];
}

/**
 * Tela da bancada (celular), aberta pelo QR Code da via da loja ou da etiqueta:
 * botões grandes para iniciar, pausar, retomar, marcar pronta e fotografar.
 */
export function Bancada({ empresaId, os, equipe, fotos, podeEntregar }: { empresaId: string; os: OsBancada; equipe: PessoaOs[]; fotos: FotoOs[]; podeEntregar: boolean }) {
  const router = useRouter();
  const [agora, setAgora] = React.useState(() => Date.now());
  const [escolher, setEscolher] = React.useState(false);
  const [pausar, setPausar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [entregar, setEntregar] = React.useState(false);
  const [pendente, iniciar] = React.useTransition();
  const etapa = os.etapa as EtapaOs;
  const pessoa = equipe.find((p) => p.id === os.responsavel_id);
  const and = andamento(os, agora);
  const minutos = tempoNaEtapa(os, agora);

  React.useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const rodar = (fn: () => Promise<{ ok: boolean; mensagem?: string }>, sucesso: string) =>
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(sucesso);
        setEscolher(false);
        setPausar(false);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível concluir.");
    });

  const iniciarCom = (pessoaId: string | null) =>
    rodar(async () => {
      if (pessoaId && pessoaId !== os.responsavel_id) {
        const a = await atribuirOs(empresaId, os.id, pessoaId);
        if (!a.ok) return a;
      }
      return moverOs(empresaId, os.id, "execucao", null);
    }, `OS nº ${os.numero} em execução.`);

  const grande = "h-14 w-full text-base";

  return (
    <div className="mx-auto max-w-lg space-y-4" data-testid="bancada">
      <header className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Ordem de serviço</p>
            <h1 className="font-mono text-3xl font-bold">#{os.numero}</h1>
            <p className="truncate text-lg font-semibold">{os.cliente_nome}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variante={ETAPA[etapa]?.variante ?? "neutro"}>{ETAPA[etapa]?.rotulo ?? etapa}</Badge>
            {os.pausada ? <Badge variante="alerta">Pausada</Badge> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1.5", etapa === "execucao" && and.situacao === "estourou" && "font-semibold text-perigo")}>
            <Clock className="size-4" aria-hidden />
            {etapa === "execucao" ? `${formatarMinutos(minutos)} de ${formatarMinutos(os.minutos_estimados)}` : etapa === "fila" ? `na fila há ${formatarMinutos(minutos)}` : etapa === "pronta" ? `pronta há ${formatarMinutos(minutos)}` : ETAPA[etapa]?.rotulo}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {pessoa ? <span className="size-3 rounded-full" style={{ background: pessoa.cor }} aria-hidden /> : <User className="size-4" aria-hidden />}
            {pessoa?.nome ?? "sem responsável"}
          </span>
        </div>
        {etapa === "execucao" ? (
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted" aria-label={`Tempo de execução: ${and.percentual}% do estimado`}>
            <div className={cn("h-full rounded-full", and.situacao === "estourou" ? "bg-perigo" : and.situacao === "perto" ? "bg-alerta" : "bg-sucesso")} style={{ width: `${Math.min(and.percentual, 100)}%` }} />
          </div>
        ) : null}
        {os.pausada && os.pausa_motivo ? <p className="mt-2 text-sm font-medium text-alerta">Motivo da pausa: {os.pausa_motivo}</p> : null}
      </header>

      {/* Ações grandes */}
      <section className="space-y-2">
        {etapa === "fila" && !escolher ? (
          <Button className={grande} disabled={pendente} onClick={() => (os.responsavel_id || !equipe.some((p) => p.ativo) ? iniciarCom(null) : setEscolher(true))}>
            {pendente ? <Loader2 className="animate-spin" /> : <Play />} Iniciar
          </Button>
        ) : null}
        {escolher ? (
          <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
            <p className="font-medium">Quem vai fazer?</p>
            <div className="grid grid-cols-2 gap-2">
              {equipe
                .filter((p) => p.ativo)
                .map((p) => (
                  <Button key={p.id} variante="contorno" className="h-12 justify-start" disabled={pendente} onClick={() => iniciarCom(p.id)}>
                    <span className="size-3 rounded-full" style={{ background: p.cor }} aria-hidden /> {p.nome}
                  </Button>
                ))}
            </div>
            <Button variante="fantasma" className="w-full" disabled={pendente} onClick={() => iniciarCom(null)}>
              Começar sem responsável
            </Button>
          </div>
        ) : null}
        {etapa === "execucao" && !os.pausada && !pausar ? (
          <div className="grid grid-cols-2 gap-2">
            <Button className={grande} disabled={pendente} onClick={() => rodar(() => moverOs(empresaId, os.id, "pronta", null), `OS nº ${os.numero} pronta.`)}>
              <CheckCheck /> Pronta
            </Button>
            <Button className={grande} variante="contorno" disabled={pendente} onClick={() => setPausar(true)}>
              <Pause /> Pausar
            </Button>
          </div>
        ) : null}
        {pausar ? (
          <form
            className="space-y-2 rounded-2xl border border-border bg-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (motivo.trim()) rodar(() => pausarOs(empresaId, os.id, motivo), "OS pausada.");
            }}
          >
            <p className="font-medium">Por que parou?</p>
            <div className="grid grid-cols-2 gap-2">
              {MOTIVOS.map((m) => (
                <Button key={m} type="button" variante={motivo === m ? "secundario" : "contorno"} className="h-11" onClick={() => setMotivo(m)}>
                  {m}
                </Button>
              ))}
            </div>
            <Input aria-label="Motivo da pausa" placeholder="Ou escreva o motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variante="fantasma" onClick={() => setPausar(false)}>
                Voltar
              </Button>
              <Button type="submit" disabled={!motivo.trim() || pendente}>
                <Pause /> Pausar
              </Button>
            </div>
          </form>
        ) : null}
        {etapa === "execucao" && os.pausada ? (
          <Button className={grande} disabled={pendente} onClick={() => rodar(() => retomarOs(empresaId, os.id), "OS retomada.")}>
            <Play /> Retomar
          </Button>
        ) : null}
        {etapa === "pronta" ? (
          podeEntregar ? (
            <Button className={grande} disabled={pendente} onClick={() => setEntregar(true)}>
              <CheckCheck /> Entregar ao cliente
            </Button>
          ) : (
            <p className="rounded-2xl border border-border bg-card p-3 text-center text-sm">Pronta — aguardando a retirada pelo cliente.</p>
          )
        ) : null}
        {etapa === "entregue" || etapa === "cancelada" ? <p className="rounded-2xl border border-border bg-card p-3 text-center text-sm">Esta OS está {ETAPA[etapa].rotulo.toLowerCase()}.</p> : null}
      </section>

      {/* O que fazer */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 font-semibold">Serviços</h2>
        <ul className="space-y-1.5">
          {os.itens.map((i, n) => (
            <li key={n} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
              <span>
                {i.descricao}
                {i.setor ? <span className="block text-xs text-muted-foreground">{i.setor}</span> : null}
              </span>
              <strong className="shrink-0">
                {String(i.quantidade).replace(".", ",")} {i.unidade}
              </strong>
            </li>
          ))}
        </ul>
        {os.descricao ? (
          <div className="mt-3 rounded-lg bg-muted/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">O que fazer (medidas, cores, detalhes)</p>
            <p className="whitespace-pre-wrap text-base">{os.descricao}</p>
          </div>
        ) : null}
        {os.observacoes ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">Obs.: {os.observacoes}</p> : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 font-semibold">Fotos</h2>
        <FotosOs empresaId={empresaId} osId={os.id} etapa={etapa} fotos={fotos} podeEnviar={etapa !== "cancelada"} compacto />
      </section>

      <p className="text-center text-sm">
        <Link href={`/e/${empresaId}/os/${os.id}`} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
          <FileText className="size-4" /> Ver a OS completa
        </Link>
      </p>

      {entregar ? (
        <DialogoEntregar
          empresaId={empresaId}
          osId={os.id}
          aoFechar={() => setEntregar(false)}
          aoEntregar={() => {
            setEntregar(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
