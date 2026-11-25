"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, Clock, Expand, MessageCircle, Pause, Play, Plus, Search, Shrink, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { atribuirOs, moverOs, pausarOs, retomarOs } from "@/lib/os/acoes";
import {
  andamento,
  atrasada,
  ETAPA,
  ETAPAS_ESTEIRA,
  entregaPrevista,
  formatarEntrega,
  formatarMinutos,
  linkWhatsApp,
  montarMensagem,
  PRIORIDADE,
  tempoNaEtapa,
  type TempoOs,
} from "@/lib/os/rotulos";
import { FormOs, type PessoaOs, type ServicoOs } from "./form-os";

export interface OsCartao extends TempoOs {
  id: string;
  numero: number;
  cliente_nome: string;
  cliente_telefone: string | null;
  prioridade: string;
  responsavel_id: string | null;
  ordem: number;
  pausa_motivo: string | null;
  codigo_publico: string;
  itens: { descricao: string; quantidade: number | string; unidade: string }[];
}

type Etapa = (typeof ETAPAS_ESTEIRA)[number];
const MOTIVOS_PAUSA = ["Falta de material", "Aguardando o cliente", "Máquina parada", "Intervalo"];
const COR_ETAPA: Record<Etapa, string> = {
  fila: "border-t-slate-400",
  execucao: "border-t-sky-500",
  pronta: "border-t-emerald-500",
  entregue: "border-t-zinc-300 dark:border-t-zinc-600",
};

function ordenar(lista: OsCartao[], etapa: Etapa) {
  const da = lista.filter((o) => o.etapa === etapa);
  if (etapa === "entregue") return da.sort((a, b) => (b.entregue_em ?? "").localeCompare(a.entregue_em ?? ""));
  return da.sort((a, b) => a.ordem - b.ordem);
}

/** Aplica na tela a mudança antes da resposta do servidor (desfeita se ele recusar). */
function aplicar(o: OsCartao, etapa: Etapa, ordem: number): OsCartao {
  if (o.etapa === etapa) return { ...o, ordem };
  const agora = new Date().toISOString();
  let execucao = Number(o.minutos_execucao) || 0;
  if (o.etapa === "execucao" && !o.pausada && o.execucao_desde) execucao += (Date.now() - new Date(o.execucao_desde).getTime()) / 60000;
  return {
    ...o,
    etapa,
    ordem,
    minutos_execucao: execucao,
    pausada: false,
    pausada_em: null,
    pausa_motivo: null,
    execucao_desde: etapa === "execucao" ? agora : null,
    iniciada_em: etapa === "fila" ? o.iniciada_em : (o.iniciada_em ?? agora),
    pronta_em: etapa === "pronta" ? agora : etapa === "entregue" ? (o.pronta_em ?? agora) : null,
    entregue_em: etapa === "entregue" ? agora : null,
  };
}

export function Esteira({
  empresaId,
  ordens,
  equipe,
  servicos,
  mensagemPronta,
  loja,
  siteUrl,
  podeGerenciar,
  executores,
}: {
  empresaId: string;
  ordens: OsCartao[];
  equipe: PessoaOs[];
  servicos: ServicoOs[];
  mensagemPronta: string | null;
  loja: string;
  siteUrl: string;
  podeGerenciar: boolean;
  executores: number;
}) {
  const router = useRouter();
  const [lista, setLista] = React.useState(ordens);
  const [recebidas, setRecebidas] = React.useState(ordens);
  // Dados novos do servidor (outra tela mexeu, ou a resposta chegou)
  if (recebidas !== ordens) {
    setRecebidas(ordens);
    setLista(ordens);
  }
  const [agora, setAgora] = React.useState(() => Date.now());
  const [busca, setBusca] = React.useState("");
  const [pessoa, setPessoa] = React.useState("");
  const [soAtrasadas, setSoAtrasadas] = React.useState(false);
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<{ etapa: Etapa; antesDe: string | null } | null>(null);
  const [nova, setNova] = React.useState(false);
  const [pausar, setPausar] = React.useState<OsCartao | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const [entregar, setEntregar] = React.useState<OsCartao | null>(null);
  const [retirado, setRetirado] = React.useState("");
  const [quem, setQuem] = React.useState<{ o: OsCartao; ordem: number | null } | null>(null);
  const [telaCheia, setTelaCheia] = React.useState(false);
  const raiz = React.useRef<HTMLDivElement>(null);
  const ocupado = Boolean(arrastando || nova || pausar || entregar || quem);

  // Relógio dos cartões e atualização automática (várias telas, ex.: TV da oficina)
  React.useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  React.useEffect(() => {
    if (ocupado) return;
    const t = window.setInterval(() => router.refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [ocupado, router]);
  React.useEffect(() => {
    const f = () => setTelaCheia(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const nomes = React.useMemo(() => new Map(equipe.map((p) => [p.id, p])), [equipe]);
  const termo = busca.trim().toLowerCase();
  const visivel = (o: OsCartao) =>
    (!termo || o.cliente_nome.toLowerCase().includes(termo) || String(o.numero) === termo.replace("#", "")) &&
    (!pessoa || (pessoa === "sem" ? !o.responsavel_id : o.responsavel_id === pessoa)) &&
    (!soAtrasadas || atrasada(o, agora));

  const ativos = lista.filter((o) => o.etapa === "fila" || o.etapa === "execucao");
  const cargaFila = lista.filter((o) => o.etapa === "fila").reduce((s, o) => s + (Number(o.minutos_estimados) || 0), 0);
  const atrasadasN = ativos.filter((o) => atrasada(o, agora)).length;
  const hoje = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
  const entreguesHoje = lista.filter((o) => o.etapa === "entregue" && o.entregue_em && new Date(new Date(o.entregue_em).getTime() - 3 * 3600_000).toISOString().slice(0, 10) === hoje).length;

  async function mover(o: OsCartao, etapa: Etapa, ordem: number | null, retiradoPor?: string) {
    const antes = lista;
    const destino = ordenar(lista.filter((x) => x.id !== o.id), etapa);
    const ordemLocal = ordem ?? (destino.length ? Math.max(...destino.map((x) => x.ordem)) + 1 : 1);
    setLista((ls) => ls.map((x) => (x.id === o.id ? aplicar(x, etapa, ordemLocal) : x)));
    const r = await moverOs(empresaId, o.id, etapa, ordem, retiradoPor);
    if (!r.ok) {
      setLista(antes);
      toast.error(r.mensagem ?? "Não foi possível mover a OS.");
    } else if (o.etapa !== etapa) {
      toast.success(`OS nº ${o.numero}: ${ETAPA[etapa].rotulo.toLowerCase()}.`);
    }
  }

  /** Pede o que falta antes de mover (quem faz, motivo, quem retirou). */
  function pedirMover(o: OsCartao, etapa: Etapa, ordem: number | null) {
    if (etapa === o.etapa) return mover(o, etapa, ordem);
    if (etapa === "entregue") {
      setRetirado("");
      setEntregar(o);
      return;
    }
    if (etapa === "execucao" && !o.responsavel_id && equipe.some((p) => p.ativo)) {
      setQuem({ o, ordem });
      return;
    }
    return mover(o, etapa, ordem);
  }

  function posicaoNoAlvo(etapa: Etapa, antesDe: string | null, id: string): number | null {
    if (etapa === "entregue") return null;
    const col = ordenar(lista.filter((x) => x.id !== id), etapa);
    if (!antesDe) return col.length ? col[col.length - 1].ordem + 1 : 1;
    const i = col.findIndex((x) => x.id === antesDe);
    if (i < 0) return null;
    const anterior = i > 0 ? col[i - 1].ordem : col[i].ordem - 2;
    return (anterior + col[i].ordem) / 2;
  }

  function aoSoltar(etapa: Etapa) {
    const o = lista.find((x) => x.id === arrastando);
    const antesDe = alvo?.etapa === etapa ? alvo.antesDe : null;
    setArrastando(null);
    setAlvo(null);
    if (!o) return;
    if (o.etapa === "entregue" && etapa !== "entregue" && !podeGerenciar) {
      toast.error("Só quem gerencia as OS reabre uma OS entregue.");
      return;
    }
    pedirMover(o, etapa, posicaoNoAlvo(etapa, antesDe, o.id));
  }

  function alternarTelaCheia() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void raiz.current?.requestFullscreen?.();
  }

  return (
    <div ref={raiz} className={cn("space-y-4", telaCheia && "overflow-auto bg-background p-4")}>
      {/* Resumo */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0" data-testid="os-resumo">
        <Resumo rotulo="Na fila" valor={lista.filter((o) => o.etapa === "fila").length} detalhe={`${formatarMinutos(cargaFila / Math.max(executores, 1))} de trabalho`} />
        <Resumo rotulo="Em execução" valor={lista.filter((o) => o.etapa === "execucao").length} detalhe={`${lista.filter((o) => o.pausada).length} pausada(s)`} tom="info" />
        <Resumo rotulo="Prontas" valor={lista.filter((o) => o.etapa === "pronta").length} detalhe="aguardando retirada" tom="sucesso" />
        <Resumo rotulo="Atrasadas" valor={atrasadasN} detalhe="passaram do prazo" tom={atrasadasN ? "perigo" : "neutro"} />
        <Resumo rotulo="Entregues hoje" valor={entreguesHoje} detalhe="retiradas pelo cliente" />
      </div>

      {/* Filtros e ações */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente ou nº" className="pl-9" aria-label="Buscar cliente ou número da OS" />
        </div>
        <Select value={pessoa} onChange={(e) => setPessoa(e.target.value)} aria-label="Filtrar por responsável" className="w-auto">
          <option value="">Toda a equipe</option>
          <option value="sem">Sem responsável</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={soAtrasadas} onChange={(e) => setSoAtrasadas(e.target.checked)} /> Só atrasadas
        </label>
        <div className="ml-auto flex gap-2">
          <Button variante="contorno" onClick={alternarTelaCheia} title="Tela cheia (para a TV da oficina)">
            {telaCheia ? <Shrink /> : <Expand />} <span className="hidden sm:inline">{telaCheia ? "Sair da tela cheia" : "Tela cheia"}</span>
          </Button>
          <Button onClick={() => setNova(true)} disabled={!servicos.some((s) => s.ativo)} title={servicos.some((s) => s.ativo) ? undefined : "Cadastre os serviços primeiro"}>
            <Plus /> Nova OS
          </Button>
        </div>
      </div>

      {/* Colunas */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
        {ETAPAS_ESTEIRA.map((etapa) => {
          const todas = ordenar(lista, etapa).filter(visivel);
          // Entregues: só as mais recentes na esteira (as demais estão no relatório)
          const col = etapa === "entregue" ? todas.slice(0, 6) : todas;
          const ativo = alvo?.etapa === etapa;
          return (
            <section
              key={etapa}
              aria-label={ETAPA[etapa].rotulo}
              data-testid={`coluna-${etapa}`}
              className={cn(
                "flex w-[85vw] max-w-sm shrink-0 snap-start flex-col rounded-2xl border border-t-4 border-border bg-muted/40 sm:w-80 lg:w-auto lg:max-w-none",
                COR_ETAPA[etapa],
                ativo && arrastando && "ring-2 ring-primary/50",
              )}
              onDragOver={(e) => {
                if (!arrastando) return;
                e.preventDefault();
                const cartoes = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-cartao]")].filter((c) => c.dataset.cartao !== arrastando);
                const antes = cartoes.find((c) => e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
                const antesDe = antes?.dataset.cartao ?? null;
                if (alvo?.etapa !== etapa || alvo.antesDe !== antesDe) setAlvo({ etapa, antesDe });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo((a) => (a?.etapa === etapa ? null : a));
              }}
              onDrop={(e) => {
                e.preventDefault();
                aoSoltar(etapa);
              }}
            >
              <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
                <h2 className="text-sm font-semibold">{ETAPA[etapa].rotulo}</h2>
                <Badge variante={ETAPA[etapa].variante}>{todas.length}</Badge>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-3">
                {col.map((o) => (
                  <React.Fragment key={o.id}>
                    {ativo && alvo?.antesDe === o.id && arrastando !== o.id ? <div className="h-1 rounded-full bg-primary/60" /> : null}
                    <Cartao
                      o={o}
                      agora={agora}
                      pessoa={o.responsavel_id ? nomes.get(o.responsavel_id) : undefined}
                      base={`/e/${empresaId}/os`}
                      arrastando={arrastando === o.id}
                      aoArrastar={() => setArrastando(o.id)}
                      aoSoltar={() => {
                        setArrastando(null);
                        setAlvo(null);
                      }}
                      aoIniciar={() => pedirMover(o, "execucao", null)}
                      aoPronta={() => pedirMover(o, "pronta", null)}
                      aoEntregar={() => pedirMover(o, "entregue", null)}
                      aoPausar={() => {
                        setMotivo("");
                        setPausar(o);
                      }}
                      aoRetomar={async () => {
                        const r = await retomarOs(empresaId, o.id);
                        if (!r.ok) toast.error(r.mensagem ?? "Não foi possível retomar.");
                      }}
                      whatsapp={linkWhatsApp(o.cliente_telefone, montarMensagem(mensagemPronta, { cliente: o.cliente_nome, numero: o.numero, link: `${siteUrl}/acompanhar/${o.codigo_publico}`, loja }))}
                    />
                  </React.Fragment>
                ))}
                {ativo && !alvo?.antesDe && arrastando ? <div className="h-1 rounded-full bg-primary/60" /> : null}
                {todas.length > col.length ? <p className="px-2 text-center text-xs text-muted-foreground">e mais {todas.length - col.length} nos últimos 7 dias</p> : null}
                {!col.length ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {etapa === "fila" ? "Nenhuma OS esperando." : etapa === "entregue" ? "Entregas dos últimos 7 dias aparecem aqui." : "Arraste uma OS para cá."}
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {/* Nova OS */}
      <Dialog open={nova} onOpenChange={setNova}>
        <DialogContent titulo="Nova ordem de serviço" descricao="Escolha os serviços: o tempo e o valor somam sozinhos, e a previsão de entrega considera a fila." largura="xl">
          <FormOs empresaId={empresaId} servicos={servicos} equipe={equipe} aoSalvar={() => setNova(false)} />
        </DialogContent>
      </Dialog>

      {/* Pausar */}
      <Dialog open={Boolean(pausar)} onOpenChange={(v) => !v && setPausar(null)}>
        <DialogContent titulo={`Pausar a OS nº ${pausar?.numero ?? ""}`} descricao="O tempo parado não conta como execução." largura="sm">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pausar) return;
              const r = await pausarOs(empresaId, pausar.id, motivo);
              if (r.ok) {
                toast.success(r.mensagem ?? "OS pausada.");
                setPausar(null);
              } else toast.error(r.mensagem ?? "Não foi possível pausar.");
            }}
          >
            <div className="flex flex-wrap gap-2">
              {MOTIVOS_PAUSA.map((m) => (
                <Button key={m} type="button" tamanho="sm" variante={motivo === m ? "secundario" : "contorno"} onClick={() => setMotivo(m)}>
                  {m}
                </Button>
              ))}
            </div>
            <Campo rotulo="Motivo" htmlFor="os-motivo-pausa" obrigatorio>
              <Input id="os-motivo-pausa" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
            </Campo>
            <div className="flex justify-end">
              <Button type="submit" disabled={!motivo.trim()}>
                <Pause /> Pausar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Entregar */}
      <Dialog open={Boolean(entregar)} onOpenChange={(v) => !v && setEntregar(null)}>
        <DialogContent titulo={`Entregar a OS nº ${entregar?.numero ?? ""}`} descricao={entregar ? `Cliente: ${entregar.cliente_nome}` : undefined} largura="sm">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!entregar) return;
              const o = entregar;
              setEntregar(null);
              void mover(o, "entregue", null, retirado);
            }}
          >
            <Campo rotulo="Quem retirou?" htmlFor="os-retirado" ajuda="Opcional: o nome de quem buscou o serviço.">
              <Input id="os-retirado" value={retirado} onChange={(e) => setRetirado(e.target.value)} maxLength={120} />
            </Campo>
            <div className="flex justify-end">
              <Button type="submit">
                <CheckCheck /> Confirmar entrega
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quem vai fazer */}
      <Dialog open={Boolean(quem)} onOpenChange={(v) => !v && setQuem(null)}>
        <DialogContent titulo={`Quem vai fazer a OS nº ${quem?.o.numero ?? ""}?`} largura="sm">
          <div className="grid gap-2">
            {equipe
              .filter((p) => p.ativo)
              .map((p) => (
                <Button
                  key={p.id}
                  variante="contorno"
                  className="justify-start"
                  onClick={async () => {
                    if (!quem) return;
                    const { o, ordem } = quem;
                    setQuem(null);
                    setLista((ls) => ls.map((x) => (x.id === o.id ? { ...x, responsavel_id: p.id } : x)));
                    const r = await atribuirOs(empresaId, o.id, p.id);
                    if (!r.ok) toast.error(r.mensagem ?? "Não foi possível definir o responsável.");
                    await mover({ ...o, responsavel_id: p.id }, "execucao", ordem);
                  }}
                >
                  <span className="size-3 rounded-full" style={{ background: p.cor }} aria-hidden /> {p.nome}
                </Button>
              ))}
            <Button
              variante="fantasma"
              onClick={() => {
                if (!quem) return;
                const { o, ordem } = quem;
                setQuem(null);
                void mover(o, "execucao", ordem);
              }}
            >
              Começar sem responsável
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Resumo({ rotulo, valor, detalhe, tom = "neutro" }: { rotulo: string; valor: number; detalhe: string; tom?: "neutro" | "info" | "sucesso" | "perigo" }) {
  const cor = { neutro: "text-titulo", info: "text-info", sucesso: "text-sucesso", perigo: "text-perigo" }[tom];
  return (
    <div className="min-w-[8.5rem] shrink-0 rounded-xl border border-border bg-card px-3 py-2 sm:min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn("text-2xl font-bold", cor)}>{valor}</p>
      <p className="truncate text-[11px] text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function Cartao({
  o,
  agora,
  pessoa,
  base,
  arrastando,
  aoArrastar,
  aoSoltar,
  aoIniciar,
  aoPronta,
  aoEntregar,
  aoPausar,
  aoRetomar,
  whatsapp,
}: {
  o: OsCartao;
  agora: number;
  pessoa?: PessoaOs;
  base: string;
  arrastando: boolean;
  aoArrastar: () => void;
  aoSoltar: () => void;
  aoIniciar: () => void;
  aoPronta: () => void;
  aoEntregar: () => void;
  aoPausar: () => void;
  aoRetomar: () => void;
  whatsapp: string | null;
}) {
  const atraso = atrasada(o, agora);
  const prio = PRIORIDADE[o.prioridade] ?? PRIORIDADE.normal;
  const and = andamento(o, agora);
  const minutos = tempoNaEtapa(o, agora);
  const entrega = entregaPrevista(o);
  const resumo = o.itens.slice(0, 2).map((i) => `${String(i.quantidade).replace(".", ",")} ${i.unidade} · ${i.descricao}`);
  const relogio =
    o.etapa === "fila"
      ? `na fila há ${formatarMinutos(minutos)}`
      : o.etapa === "execucao"
        ? `${formatarMinutos(minutos)} de ${formatarMinutos(o.minutos_estimados)}`
        : o.etapa === "pronta"
          ? `pronta há ${formatarMinutos(minutos)}`
          : o.entregue_em
            ? `entregue ${formatarEntrega(o.entregue_em)}`
            : "";

  return (
    <article
      data-cartao={o.id}
      data-testid="cartao-os"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", o.id);
        aoArrastar();
      }}
      onDragEnd={aoSoltar}
      className={cn(
        "group cursor-grab rounded-xl border bg-card p-3 shadow-sm transition-[box-shadow,opacity,transform] hover:shadow-md active:cursor-grabbing",
        atraso ? "border-perigo/60" : "border-border",
        arrastando && "opacity-40",
        o.etapa === "entregue" && "opacity-75",
      )}
    >
      <Link href={`${base}/${o.id}`} draggable={false} className="block space-y-1.5 focus-visible:outline-none">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">#{o.numero}</span>
          {o.prioridade !== "normal" ? <Badge variante={prio.variante}>{prio.rotulo}</Badge> : null}
          {atraso && o.etapa !== "entregue" ? (
            <Badge variante="perigo">
              <AlertTriangle /> Atrasada
            </Badge>
          ) : null}
          {o.pausada ? (
            <Badge variante="alerta">
              <Pause /> Pausada
            </Badge>
          ) : null}
        </div>
        <p className="line-clamp-1 font-medium">{o.cliente_nome}</p>
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {resumo.map((r, i) => (
            <li key={i} className="line-clamp-1">
              {r}
            </li>
          ))}
          {o.itens.length > 2 ? <li>+ {o.itens.length - 2} serviço(s)</li> : null}
        </ul>
        {o.pausada && o.pausa_motivo ? <p className="text-xs text-alerta">Motivo: {o.pausa_motivo}</p> : null}
        {o.etapa === "execucao" ? (
          <div className="pt-1" aria-label={`Tempo de execução: ${and.percentual}% do estimado`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width]", and.situacao === "estourou" ? "bg-perigo" : and.situacao === "perto" ? "bg-alerta" : "bg-sucesso")}
                style={{ width: `${Math.min(and.percentual, 100)}%` }}
              />
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1", o.etapa === "execucao" && and.situacao === "estourou" && "font-medium text-perigo")}>
            <Clock className="size-3" aria-hidden /> {relogio}
          </span>
          {pessoa ? (
            <span className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-full" style={{ background: pessoa.cor }} aria-hidden /> {pessoa.nome}
            </span>
          ) : o.etapa !== "entregue" ? (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" aria-hidden /> sem responsável
            </span>
          ) : null}
        </div>
        {entrega && (o.etapa === "fila" || o.etapa === "execucao") ? (
          <p className={cn("text-[11px]", atraso ? "font-medium text-perigo" : "text-muted-foreground")}>
            {o.prazo ? "Prazo" : "Previsão"}: {formatarEntrega(entrega)}
          </p>
        ) : null}
      </Link>
      {o.etapa !== "entregue" ? (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
          {o.etapa === "fila" ? (
            <Button tamanho="sm" variante="secundario" onClick={aoIniciar}>
              <Play /> Iniciar
            </Button>
          ) : null}
          {o.etapa === "execucao" ? (
            <>
              <Button tamanho="sm" variante="secundario" onClick={aoPronta}>
                <CheckCheck /> Pronta
              </Button>
              {o.pausada ? (
                <Button tamanho="sm" variante="contorno" onClick={aoRetomar}>
                  <Play /> Retomar
                </Button>
              ) : (
                <Button tamanho="sm" variante="contorno" onClick={aoPausar}>
                  <Pause /> Pausar
                </Button>
              )}
            </>
          ) : null}
          {o.etapa === "pronta" ? (
            <>
              <Button tamanho="sm" variante="secundario" onClick={aoEntregar}>
                <CheckCheck /> Entregar
              </Button>
              {whatsapp ? (
                <Button tamanho="sm" variante="contorno" asChild>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle /> Avisar
                  </a>
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
