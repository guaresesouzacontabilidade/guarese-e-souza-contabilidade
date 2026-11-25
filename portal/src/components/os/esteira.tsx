"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, ChevronsRight, Clock, Cog, Expand, MessageCircle, MessageCircleMore, Pause, Play, Plus, Search, Shrink, User, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { atribuirOs, moverOs, pausarOs, retomarOs } from "@/lib/os/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import {
  andamento,
  atrasada,
  ETAPA,
  ETAPAS_ESTEIRA,
  entregaPrevista,
  faltaReceber,
  formatarEntrega,
  formatarMinutos,
  linkWhatsApp,
  montarMensagem,
  PRIORIDADE,
  situacaoPagamento,
  tempoNaEtapa,
  type TempoOs,
  type ValoresOs,
} from "@/lib/os/rotulos";
import { DialogoEntregar } from "./entregar-os";
import { FormOs, type PessoaOs, type ServicoOs } from "./form-os";
import { DialogoReceber } from "./receber-os";

export interface OsCartao extends TempoOs, ValoresOs {
  id: string;
  numero: number;
  cliente_nome: string;
  cliente_telefone: string | null;
  prioridade: string;
  responsavel_id: string | null;
  ordem: number;
  pausa_motivo: string | null;
  codigo_publico: string;
  aviso_whatsapp: string | null;
  itens: { descricao: string; quantidade: number | string; unidade: string; setor?: string | null }[];
}

export interface FilaSetor {
  setor: string;
  maquinas: number;
  minutos: number;
  ordens: number;
}

const chaveSetor = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

type Etapa = (typeof ETAPAS_ESTEIRA)[number];
const MOTIVOS_PAUSA = ["Falta de material", "Aguardando o cliente", "Máquina parada", "Intervalo"];
/** O que cada estação da esteira representa na oficina. */
const ESTACAO: Record<Etapa, string> = {
  fila: "Entrada",
  execucao: "Produção",
  pronta: "Expedição",
  entregue: "Saída · últimos 7 dias",
};
/** Colunas da esteira: no celular cada estação ocupa quase a tela e a esteira rola de lado. */
const GRADE = "grid grid-cols-[repeat(4,min(82vw,20rem))] lg:grid-cols-4";

/** Troca o estado com a caixa deslizando até a nova estação (quando o navegador permite). */
function comDeslize(mudar: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mudar();
    return;
  }
  doc.startViewTransition(() => flushSync(mudar));
}

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
  podeReceber = false,
  whatsappAtivo = false,
  filaSetores = [],
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
  /** Opera o caixa da Loja (recebe sinal e restante pela OS) */
  podeReceber?: boolean;
  whatsappAtivo?: boolean;
  /** Trabalho na frente de cada setor ou máquina */
  filaSetores?: FilaSetor[];
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
  const [setor, setSetor] = React.useState("");
  const [receber, setReceber] = React.useState<string | null>(null);
  const [soAtrasadas, setSoAtrasadas] = React.useState(false);
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<{ etapa: Etapa; antesDe: string | null } | null>(null);
  const [nova, setNova] = React.useState(false);
  const [pausar, setPausar] = React.useState<OsCartao | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const [entregar, setEntregar] = React.useState<OsCartao | null>(null);
  const [quem, setQuem] = React.useState<{ o: OsCartao; ordem: number | null } | null>(null);
  const [telaCheia, setTelaCheia] = React.useState(false);
  const raiz = React.useRef<HTMLDivElement>(null);
  const ocupado = Boolean(arrastando || nova || pausar || entregar || quem || receber);

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
  const setores = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servicos) if (s.setor?.trim()) m.set(chaveSetor(s.setor), s.setor.trim());
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [servicos]);
  const termo = busca.trim().toLowerCase();
  const visivel = (o: OsCartao) =>
    (!termo || o.cliente_nome.toLowerCase().includes(termo) || String(o.numero) === termo.replace("#", "")) &&
    (!pessoa || (pessoa === "sem" ? !o.responsavel_id : o.responsavel_id === pessoa)) &&
    (!setor || o.itens.some((i) => chaveSetor(i.setor) === setor)) &&
    (!soAtrasadas || atrasada(o, agora));

  const ativos = lista.filter((o) => o.etapa === "fila" || o.etapa === "execucao");
  const cargaFila = lista.filter((o) => o.etapa === "fila").reduce((s, o) => s + (Number(o.minutos_estimados) || 0), 0);
  const atrasadasN = ativos.filter((o) => atrasada(o, agora)).length;
  const emExecucao = lista.filter((o) => o.etapa === "execucao");
  const pausadasN = emExecucao.filter((o) => o.pausada).length;
  // A esteira só gira com alguma OS sendo feita agora
  const rodando = emExecucao.some((o) => !o.pausada);
  const hoje = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
  const entreguesHoje = lista.filter((o) => o.etapa === "entregue" && o.entregue_em && new Date(new Date(o.entregue_em).getTime() - 3 * 3600_000).toISOString().slice(0, 10) === hoje).length;

  async function mover(o: OsCartao, etapa: Etapa, ordem: number | null, retiradoPor?: string) {
    const antes = lista;
    const destino = ordenar(lista.filter((x) => x.id !== o.id), etapa);
    const ordemLocal = ordem ?? (destino.length ? Math.max(...destino.map((x) => x.ordem)) + 1 : 1);
    comDeslize(() => setLista((ls) => ls.map((x) => (x.id === o.id ? aplicar(x, etapa, ordemLocal) : x))));
    const r = await moverOs(empresaId, o.id, etapa, ordem, retiradoPor);
    if (!r.ok) {
      comDeslize(() => setLista(antes));
      toast.error(r.mensagem ?? "Não foi possível mover a OS.");
    } else if (o.etapa !== etapa) {
      toast.success(`OS nº ${o.numero}: ${ETAPA[etapa].rotulo.toLowerCase()}.`);
    }
  }

  /** Pede o que falta antes de mover (quem faz, motivo, quem retirou). */
  function pedirMover(o: OsCartao, etapa: Etapa, ordem: number | null) {
    if (etapa === o.etapa) return mover(o, etapa, ordem);
    if (etapa === "entregue") {
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
        {setores.length ? (
          <Select value={setor} onChange={(e) => setSetor(e.target.value)} aria-label="Filtrar por setor ou máquina" className="w-auto">
            <option value="">Todas as máquinas</option>
            {setores.map(([k, nome]) => (
              <option key={k} value={k}>
                {nome}
              </option>
            ))}
          </Select>
        ) : null}
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

      {/* Esteira */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="esteira-status">
        <span className="luz-estacao" data-cor={rodando ? "verde" : pausadasN ? "amarela" : undefined} aria-hidden />
        <span className="font-semibold">{rodando ? "Esteira rodando" : "Esteira parada"}</span>
        <span className="text-muted-foreground">
          {rodando
            ? `${emExecucao.length - pausadasN} OS sendo feita(s) agora${pausadasN ? ` · ${pausadasN} pausada(s)` : ""}`
            : pausadasN
              ? `${pausadasN} OS pausada(s) na produção`
              : "nenhuma OS em produção agora"}
        </span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Arraste as caixas de uma estação para outra ou use os botões.</span>
      </div>
      {filaSetores.some((f) => f.setor) ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" data-testid="fila-setores" aria-label="Fila por setor ou máquina">
          {filaSetores.map((f) => (
            <button
              key={f.setor || "geral"}
              type="button"
              onClick={() => setSetor((atual) => (atual === chaveSetor(f.setor) || !f.setor ? "" : chaveSetor(f.setor)))}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                setor && setor === chaveSetor(f.setor) ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted",
              )}
              title={`${f.ordens} OS na frente`}
            >
              <span className="font-semibold">{f.setor || "Sem setor"}</span> · {formatarMinutos(f.minutos / Math.max(f.maquinas, 1))} de fila
              <span className="text-muted-foreground">
                {" "}
                ({f.maquinas} {f.maquinas === 1 ? "máquina" : "máquinas"})
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:overflow-visible lg:px-0">
        <div className="w-max lg:w-full">
          {/* Placas das estações */}
          <div className={GRADE}>
            {ETAPAS_ESTEIRA.map((etapa, i) => {
              const n = lista.filter((o) => o.etapa === etapa).filter(visivel).length;
              const luz = etapa === "execucao" ? (rodando ? "verde" : pausadasN ? "amarela" : undefined) : etapa === "pronta" && n ? "verde" : etapa === "fila" && n ? "amarela" : undefined;
              return (
                <div key={etapa} className="snap-start px-1.5 pb-2.5">
                  <div className="placa-estacao flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-800 font-mono text-sm font-bold text-amber-400" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold leading-tight">{ETAPA[etapa].rotulo}</h2>
                      <p className="truncate text-[11px] text-muted-foreground">{ESTACAO[etapa]}</p>
                    </div>
                    {etapa === "execucao" && rodando ? <Cog className="size-5 shrink-0 animate-[girar_2.4s_linear_infinite] text-sky-500" aria-hidden /> : null}
                    <span className="luz-estacao shrink-0" data-cor={luz} aria-hidden />
                    <Badge variante={ETAPA[etapa].variante}>{n}</Badge>
                  </div>
                </div>
              );
            })}
          </div>

          {/* A faixa da esteira, dividida nas 4 estações */}
          <div className={cn("esteira-faixa rounded-xl", GRADE)} data-rodando={rodando ? "true" : "false"}>
            {ETAPAS_ESTEIRA.map((etapa, i) => {
              const todas = ordenar(lista, etapa).filter(visivel);
              // Entregues: só as mais recentes na esteira (as demais estão no relatório)
              const col = etapa === "entregue" ? todas.slice(0, 6) : todas;
              const ativo = alvo?.etapa === etapa;
              return (
                <section
                  key={etapa}
                  aria-label={ETAPA[etapa].rotulo}
                  data-testid={`coluna-${etapa}`}
                  className={cn("relative flex min-h-[18rem] flex-col gap-3.5 px-3 pb-6 pt-5", i > 0 && "esteira-divisa", ativo && arrastando && "bg-amber-300/10 ring-2 ring-inset ring-amber-400/70")}
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
                  {i > 0 ? (
                    <span className="absolute -left-[15px] top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-zinc-800 text-amber-400 shadow ring-2 ring-[#2a2e35]" aria-hidden>
                      <ChevronsRight className="size-4" />
                    </span>
                  ) : null}
                  {col.map((o) => (
                    <React.Fragment key={o.id}>
                      {ativo && alvo?.antesDe === o.id && arrastando !== o.id ? <div className="h-1 rounded-full bg-amber-400" /> : null}
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
                        aoReceber={podeReceber ? () => setReceber(o.id) : undefined}
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
                  {ativo && !alvo?.antesDe && arrastando ? <div className="h-1 rounded-full bg-amber-400" /> : null}
                  {todas.length > col.length ? <p className="px-2 text-center text-xs text-zinc-300">e mais {todas.length - col.length} nos últimos 7 dias</p> : null}
                  {!col.length ? (
                    <p className="my-auto px-4 text-center text-xs text-zinc-400">
                      {etapa === "fila" ? "Nenhuma OS esperando." : etapa === "entregue" ? "As entregas dos últimos 7 dias aparecem aqui." : "Arraste uma OS para cá."}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>

          {/* Roletes e pés da esteira */}
          <div className="esteira-roletes -mt-2 flex justify-between px-4" aria-hidden>
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="esteira-rolete" />
            ))}
          </div>
          <div className="flex justify-between px-10" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="esteira-pe" />
            ))}
          </div>
        </div>
      </div>

      {/* Nova OS */}
      <Dialog open={nova} onOpenChange={setNova}>
        <DialogContent titulo="Nova ordem de serviço" descricao="Escolha os serviços: o tempo e o valor somam sozinhos, e a previsão de entrega considera a fila." largura="xl">
          <FormOs
            empresaId={empresaId}
            servicos={servicos}
            equipe={equipe}
            whatsappAtivo={whatsappAtivo}
            podeReceber={podeReceber}
            aoSalvar={(id, opcoes) => {
              setNova(false);
              if (opcoes?.receberSinal) setReceber(id);
            }}
          />
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

      {/* Entregar (com o que falta receber, quem retirou e a assinatura) */}
      {entregar ? (
        <DialogoEntregar
          empresaId={empresaId}
          osId={entregar.id}
          aoFechar={() => setEntregar(null)}
          aoEntregar={() => {
            const o = entregar;
            setEntregar(null);
            comDeslize(() => setLista((ls) => ls.map((x) => (x.id === o.id ? aplicar(x, "entregue", 0) : x))));
            router.refresh();
          }}
        />
      ) : null}
      {receber ? <DialogoReceber empresaId={empresaId} osId={receber} aoFechar={() => setReceber(null)} /> : null}

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
  aoReceber,
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
  aoReceber?: () => void;
  whatsapp: string | null;
}) {
  const atraso = atrasada(o, agora);
  const prio = PRIORIDADE[o.prioridade] ?? PRIORIDADE.normal;
  const and = andamento(o, agora);
  const minutos = tempoNaEtapa(o, agora);
  const entrega = entregaPrevista(o);
  const pagamento = situacaoPagamento(o);
  const falta = faltaReceber(o);
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

  const carimbos = [
    o.prioridade !== "normal" ? { texto: prio.rotulo, cor: o.prioridade === "urgente" ? "text-red-700" : "text-orange-700" } : null,
    atraso && o.etapa !== "entregue" ? { texto: "Atrasada", cor: "text-red-700" } : null,
    o.pausada ? { texto: "Pausada", cor: "text-amber-700" } : null,
  ].filter((c): c is { texto: string; cor: string } => Boolean(c));
  const botao = "h-8 border px-2.5 text-xs shadow-none";
  const principal = cn(botao, "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-700 hover:text-white");
  const secundario = cn(botao, "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 hover:text-zinc-900");

  return (
    <article
      data-cartao={o.id}
      data-testid="cartao-os"
      data-entregue={o.etapa === "entregue" ? "true" : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", o.id);
        aoArrastar();
      }}
      onDragEnd={aoSoltar}
      style={{ viewTransitionName: `os-${o.id}` }}
      className={cn("caixa-os group shrink-0 cursor-grab transition-[opacity,transform] hover:-translate-y-0.5 active:cursor-grabbing", arrastando && "opacity-40")}
    >
      <div className={cn("etiqueta-os", atraso && o.etapa !== "entregue" && "ring-2 ring-red-600/70")}>
        <Link href={`${base}/${o.id}`} draggable={false} className="block space-y-1.5 rounded-t-[4px] p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600">
          <div className="flex items-start justify-between gap-2 border-b border-dashed border-zinc-300 pb-1.5">
            <p className="font-mono leading-none">
              <span className="block text-[9px] font-semibold uppercase tracking-widest text-[#5b6170]">Ordem de serviço</span>
              <span className="text-lg font-bold text-[#1c2230]">#{o.numero}</span>
            </p>
            {carimbos.length ? (
              <div className="flex flex-wrap justify-end gap-1 pt-0.5">
                {carimbos.map((c) => (
                  <span key={c.texto} className={cn("carimbo-os", c.cor)}>
                    {c.texto}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <p className="line-clamp-1 font-semibold text-[#1c2230]">{o.cliente_nome}</p>
          <ul className="space-y-0.5 text-xs text-[#5b6170]">
            {resumo.map((r, i) => (
              <li key={i} className="line-clamp-1">
                {r}
              </li>
            ))}
            {o.itens.length > 2 ? <li>+ {o.itens.length - 2} serviço(s)</li> : null}
          </ul>
          {o.pausada && o.pausa_motivo ? <p className="text-xs font-medium text-amber-800">Motivo: {o.pausa_motivo}</p> : null}
          {o.etapa === "execucao" ? (
            <div className="pt-1" aria-label={`Tempo de execução: ${and.percentual}% do estimado`}>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                <div
                  className={cn("h-full rounded-full transition-[width]", and.situacao === "estourou" ? "bg-red-600" : and.situacao === "perto" ? "bg-amber-500" : "bg-emerald-600")}
                  style={{ width: `${Math.min(and.percentual, 100)}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-0.5 text-[11px] text-[#5b6170]">
            <span className={cn("inline-flex items-center gap-1", o.etapa === "execucao" && and.situacao === "estourou" && "font-semibold text-red-700")}>
              <Clock className="size-3" aria-hidden /> {relogio}
            </span>
            {pessoa ? (
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full ring-1 ring-black/10" style={{ background: pessoa.cor }} aria-hidden /> {pessoa.nome}
              </span>
            ) : o.etapa !== "entregue" ? (
              <span className="inline-flex items-center gap-1">
                <User className="size-3" aria-hidden /> sem responsável
              </span>
            ) : null}
          </div>
          {entrega && (o.etapa === "fila" || o.etapa === "execucao") ? (
            <p className={cn("text-[11px]", atraso ? "font-semibold text-red-700" : "text-[#5b6170]")}>
              {o.prazo ? "Prazo" : "Previsão"}: {formatarEntrega(entrega)}
            </p>
          ) : null}
          {pagamento !== "sem_valor" || o.aviso_whatsapp === "enviado" ? (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]" data-testid="cartao-pagamento">
              {pagamento === "pago" ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <Wallet className="size-3" aria-hidden /> Pago
                </span>
              ) : pagamento === "a_receber" ? (
                <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                  <Wallet className="size-3" aria-hidden /> A receber {formatarMoeda(Number(o.valor_a_receber))}
                </span>
              ) : pagamento === "parcial" ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                  <Wallet className="size-3" aria-hidden /> Falta {formatarMoeda(falta)}
                </span>
              ) : pagamento === "aberto" ? (
                <span className="inline-flex items-center gap-1 text-[#5b6170]">
                  <Wallet className="size-3" aria-hidden /> {formatarMoeda(falta)} a pagar
                </span>
              ) : (
                <span />
              )}
              {o.aviso_whatsapp === "enviado" ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <MessageCircleMore className="size-3" aria-hidden /> Cliente avisado
                </span>
              ) : null}
            </div>
          ) : null}
        </Link>
        {o.etapa !== "entregue" ? (
          <div className="flex flex-wrap gap-1.5 border-t border-zinc-200 px-2.5 py-2">
            {o.etapa === "fila" ? (
              <Button tamanho="sm" variante="fantasma" className={principal} onClick={aoIniciar}>
                <Play /> Iniciar
              </Button>
            ) : null}
            {o.etapa === "execucao" ? (
              <>
                <Button tamanho="sm" variante="fantasma" className={principal} onClick={aoPronta}>
                  <CheckCheck /> Pronta
                </Button>
                {o.pausada ? (
                  <Button tamanho="sm" variante="fantasma" className={secundario} onClick={aoRetomar}>
                    <Play /> Retomar
                  </Button>
                ) : (
                  <Button tamanho="sm" variante="fantasma" className={secundario} onClick={aoPausar}>
                    <Pause /> Pausar
                  </Button>
                )}
              </>
            ) : null}
            {o.etapa === "pronta" ? (
              <>
                <Button tamanho="sm" variante="fantasma" className={principal} onClick={aoEntregar}>
                  <CheckCheck /> Entregar
                </Button>
                {whatsapp && o.aviso_whatsapp !== "enviado" ? (
                  <Button tamanho="sm" variante="fantasma" className={secundario} asChild>
                    <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                      <MessageCircle /> Avisar
                    </a>
                  </Button>
                ) : null}
              </>
            ) : null}
            {aoReceber && falta > 0 ? (
              <Button tamanho="sm" variante="fantasma" className={secundario} onClick={aoReceber}>
                <Wallet /> Receber
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
