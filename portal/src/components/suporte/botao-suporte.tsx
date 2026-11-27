"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, ArrowRight, BookOpen, Bot, LifeBuoy, Loader2, MessageCircle, RotateCcw, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { avaliarSuporte, infoSuporte, perguntarSuporte, type RespostaSuporte } from "@/lib/suporte/acoes";
import { sugestoesDaTela } from "@/lib/suporte/busca";

type Mensagem =
  | { id: number; de: "pessoa"; texto: string }
  | { id: number; de: "suporte"; pergunta: string; r: RespostaSuporte; avaliacao?: boolean }
  | { id: number; de: "erro"; texto: string };

const CHAVE = "suporte-conversa";
const CHAVE_POSICAO = "suporte-posicao";
const MARGEM = 16;

/** Onde a pessoa deixou o botão: lado da tela e distância até o pé da tela (px). */
type Posicao = { lado: "esquerda" | "direita"; baixo: number };

function lerPosicao(): Posicao | null {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_POSICAO) ?? "null") as Posicao | null;
    return p && (p.lado === "esquerda" || p.lado === "direita") && Number.isFinite(p.baixo) ? p : null;
  } catch {
    return null;
  }
}

function salvarPosicao(p: Posicao | null) {
  try {
    if (p) localStorage.setItem(CHAVE_POSICAO, JSON.stringify(p));
    else localStorage.removeItem(CHAVE_POSICAO);
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
}

/**
 * Suporte 24h: botão de ajuda em todas as telas. Responde com os trechos do
 * Guia de uso e os atalhos das telas que a pessoa pode abrir; com o assistente
 * de IA ligado pelo escritório, a resposta vem escrita pela IA. A conversa fica
 * só nesta aba do navegador.
 */
export function BotaoSuporte({ equipe, empresaId, podeSolicitar, comBarraInferior }: { equipe: boolean; empresaId: string | null; podeSolicitar: boolean; comBarraInferior: boolean }) {
  const caminho = usePathname();
  const [aberto, setAberto] = React.useState(false);
  const [mensagens, setMensagens] = React.useState<Mensagem[]>([]);
  const [texto, setTexto] = React.useState("");
  const [info, setInfo] = React.useState<{ ia: boolean; whatsapp: string | null } | null>(null);
  const [pendente, iniciar] = React.useTransition();
  const fim = React.useRef<HTMLDivElement>(null);
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const seq = React.useRef(1);
  // Botão móvel: arraste para outro lugar (gruda no lado mais perto); o lugar fica guardado neste aparelho
  const [posicao, setPosicao] = React.useState<Posicao | null>(null);
  const [arraste, setArraste] = React.useState<{ x: number; y: number } | null>(null);
  const botao = React.useRef<HTMLButtonElement>(null);
  const inicioArraste = React.useRef<{ px: number; py: number; x: number; y: number; moveu: boolean } | null>(null);
  // Até quando ignorar o clique do navegador (já tratado ao soltar o dedo, ou que vem logo depois de um arraste)
  const ignorarCliqueAte = React.useRef(0);

  const baixoMinimo = React.useCallback(() => (comBarraInferior && window.innerWidth < 1024 ? 88 : MARGEM), [comBarraInferior]);
  const limitar = React.useCallback(
    (p: Posicao): Posicao => {
      const altura = botao.current?.offsetHeight ?? 48;
      const maximo = Math.max(baixoMinimo(), window.innerHeight - altura - 72);
      return { lado: p.lado, baixo: Math.round(Math.min(Math.max(p.baixo, baixoMinimo()), maximo)) };
    },
    [baixoMinimo],
  );
  React.useEffect(() => {
    const salvo = lerPosicao();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (salvo) setPosicao(limitar(salvo));
    const aoRedimensionar = () => setPosicao((p) => (p ? limitar(p) : p));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [limitar]);

  function mudarPosicao(p: Posicao | null) {
    const final = p ? limitar(p) : null;
    setPosicao(final);
    salvarPosicao(final);
  }

  function aoApertar(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    inicioArraste.current = { px: e.clientX, py: e.clientY, x: r.left, y: r.top, moveu: false };
    // Segura o ponteiro já no toque: num arraste rápido ele sai do botão antes de andar 6 px
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* navegador sem captura: o arraste lento continua funcionando */
    }
  }
  function aoMover(e: React.PointerEvent<HTMLButtonElement>) {
    const i = inicioArraste.current;
    if (!i) return;
    const dx = e.clientX - i.px;
    const dy = e.clientY - i.py;
    if (!i.moveu && Math.hypot(dx, dy) < 6) return;
    i.moveu = true;
    const r = e.currentTarget.getBoundingClientRect();
    setArraste({
      x: Math.min(Math.max(i.x + dx, 4), window.innerWidth - r.width - 4),
      y: Math.min(Math.max(i.y + dy, 4), window.innerHeight - r.height - 4),
    });
  }
  function aoSoltar(e: React.PointerEvent<HTMLButtonElement>) {
    const i = inicioArraste.current;
    inicioArraste.current = null;
    if (!i) return;
    if (!i.moveu) {
      // Toque com o dedo ou caneta: abre já ao soltar (depois de um arraste, o celular às vezes não gera o clique)
      if (e.pointerType !== "mouse") {
        ignorarCliqueAte.current = Date.now() + 700;
        setAberto((v) => !v);
      }
      return;
    }
    // Soltar depois de arrastar não abre a ajuda
    ignorarCliqueAte.current = Date.now() + 700;
    const r = e.currentTarget.getBoundingClientRect();
    setArraste(null);
    mudarPosicao({ lado: r.left + r.width / 2 < window.innerWidth / 2 ? "esquerda" : "direita", baixo: window.innerHeight - r.bottom });
  }
  const ladoAtual = posicao?.lado ?? "direita";

  // Com o botão fora do lugar padrão, a janela abre colada nele (em cima ou embaixo, onde couber) para não cobri-lo
  const [ancora, setAncora] = React.useState<React.CSSProperties | undefined>(undefined);
  React.useEffect(() => {
    function calcular() {
      const r = botao.current?.getBoundingClientRect();
      if (!aberto || !posicao || !r || window.innerWidth < 640) return setAncora(undefined);
      const acima = r.top - 12 - MARGEM;
      const abaixo = window.innerHeight - r.bottom - 12 - MARGEM;
      const teto = Math.round(window.innerHeight * 0.7);
      setAncora(
        acima >= 320 || acima >= abaixo
          ? { top: "auto", bottom: Math.round(window.innerHeight - r.top + 12), maxHeight: Math.min(teto, Math.round(acima)) }
          : { top: Math.round(r.bottom + 12), bottom: "auto", maxHeight: Math.min(teto, Math.round(abaixo)) },
      );
    }
    calcular();
    if (!aberto) return;
    window.addEventListener("resize", calcular);
    return () => window.removeEventListener("resize", calcular);
  }, [aberto, posicao]);

  // Conversa guardada só nesta aba (some ao fechar o navegador)
  React.useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(CHAVE);
      if (salvo) {
        const lista = JSON.parse(salvo) as Mensagem[];
        seq.current = (lista.at(-1)?.id ?? 0) + 1;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMensagens(lista);
      }
    } catch {
      /* sem armazenamento: começa vazia */
    }
  }, []);
  React.useEffect(() => {
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify(mensagens.slice(-20)));
    } catch {
      /* sem armazenamento */
    }
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);
  React.useEffect(() => {
    if (!aberto) return;
    if (!info) void infoSuporte().then((i) => setInfo(i)).catch(() => setInfo({ ia: false, whatsapp: null }));
    window.setTimeout(() => campo.current?.focus(), 50);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, info]);

  function perguntar(p: string) {
    const pergunta = p.trim();
    if (pergunta.length < 2 || pendente) return;
    setTexto("");
    setMensagens((m) => [...m, { id: seq.current++, de: "pessoa", texto: pergunta }]);
    iniciar(async () => {
      try {
        const r = await perguntarSuporte(pergunta, caminho);
        setMensagens((m) => [...m, r.ok && r.dados ? { id: seq.current++, de: "suporte", pergunta, r: r.dados } : { id: seq.current++, de: "erro", texto: r.mensagem ?? "Não consegui responder agora." }]);
      } catch {
        setMensagens((m) => [...m, { id: seq.current++, de: "erro", texto: "Sem conexão com o portal agora. Tente de novo em instantes." }]);
      }
    });
  }

  function avaliar(id: number, util: boolean) {
    const m = mensagens.find((x) => x.id === id);
    if (!m || m.de !== "suporte" || !m.r.registro) return;
    setMensagens((ms) => ms.map((x) => (x.id === id && x.de === "suporte" ? { ...x, avaliacao: util } : x)));
    void avaliarSuporte(m.r.registro, util, m.pergunta).catch(() => undefined);
  }

  const linkSolicitacao = (pergunta: string) =>
    `/e/${empresaId}/solicitacoes/nova?servico=outro&titulo=${encodeURIComponent(pergunta.slice(0, 150))}&descricao=${encodeURIComponent(`${pergunta}\n\n(Enviado pelo suporte do portal.)`)}`;
  const whatsapp = info?.whatsapp ? `https://wa.me/55${info.whatsapp.replace(/\D/g, "").replace(/^55/, "")}` : null;
  const sugestoes = sugestoesDaTela(caminho, equipe);

  return (
    <div className="nao-imprimir">
      <Button
        ref={botao}
        onClick={() => {
          // Clique já tratado ao soltar o dedo, ou logo depois de arrastar (teclado e mouse seguem por aqui)
          if (Date.now() < ignorarCliqueAte.current) {
            ignorarCliqueAte.current = 0;
            return;
          }
          setAberto((v) => !v);
        }}
        onPointerDown={aoApertar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={() => {
          inicioArraste.current = null;
          setArraste(null);
        }}
        aria-expanded={aberto}
        aria-controls="painel-suporte"
        aria-label={aberto ? "Fechar o suporte" : "Abrir o suporte 24h"}
        title="Clique para abrir a ajuda. Segure e arraste para mudar o botão de lugar."
        className={cn(
          "fixed z-40 h-12 touch-none select-none rounded-full px-4 shadow-lg",
          arraste ? "cursor-grabbing transition-none" : "",
          posicao || arraste ? "" : cn("right-4 lg:bottom-6", comBarraInferior ? "bottom-[5.5rem]" : "bottom-5"),
        )}
        style={
          arraste
            ? { left: arraste.x, top: arraste.y }
            : posicao
              ? { bottom: posicao.baixo, [posicao.lado === "esquerda" ? "left" : "right"]: MARGEM }
              : undefined
        }
        data-testid="botao-suporte"
        data-lado={ladoAtual}
      >
        {aberto ? <X /> : <LifeBuoy />}
        <span className="hidden sm:inline">{aberto ? "Fechar" : "Ajuda"}</span>
      </Button>

      {aberto ? <div className="fixed inset-0 z-30 bg-black/40 sm:hidden" aria-hidden onClick={() => setAberto(false)} /> : null}
      {aberto ? (
        <section
          id="painel-suporte"
          role="dialog"
          aria-label="Suporte 24h"
          className={cn(
            "fixed inset-x-0 z-40 flex flex-col overflow-hidden border border-border bg-card shadow-2xl sm:inset-x-auto sm:w-[24rem] sm:rounded-2xl lg:bottom-[5.25rem]",
            ladoAtual === "esquerda" ? "sm:left-4" : "sm:right-4",
            comBarraInferior ? "bottom-[9rem] top-16 rounded-t-2xl sm:top-auto sm:max-h-[70dvh]" : "bottom-[4.5rem] top-16 rounded-t-2xl sm:top-auto sm:max-h-[70dvh]",
          )}
          style={ancora}
          data-testid="painel-suporte"
        >
          <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="font-semibold">Suporte 24h</p>
              <p className="text-xs text-muted-foreground">Dúvidas sobre como usar o portal, a qualquer hora.</p>
            </div>
            <div className="flex items-center gap-1">
              {info ? (
                info.ia ? (
                  <Badge variante="info">
                    <Bot /> Assistente com IA
                  </Badge>
                ) : (
                  <Badge>
                    <BookOpen /> Busca no guia
                  </Badge>
                )
              ) : null}
              <Button tamanho="iconeSm" variante="fantasma" className="-mr-2" onClick={() => setAberto(false)} aria-label="Fechar a ajuda" title="Fechar (Esc)">
                <X />
              </Button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            <div className="rounded-2xl rounded-tl-sm bg-muted/60 px-3 py-2">
              Olá! Me diga o que você quer fazer no portal e eu mostro como — e levo você direto para a tela certa.
            </div>
            {!mensagens.length ? (
              <div className="flex flex-wrap gap-1.5">
                {sugestoes.map((s) => (
                  <Button key={s} tamanho="sm" variante="contorno" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => perguntar(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            ) : null}
            {mensagens.map((m) =>
              m.de === "pessoa" ? (
                <div key={m.id} className="ml-8 rounded-2xl rounded-tr-sm bg-primary/15 px-3 py-2 text-right">
                  {m.texto}
                </div>
              ) : m.de === "erro" ? (
                <div key={m.id} className="rounded-2xl bg-perigo-bg px-3 py-2 text-perigo-fg">
                  {m.texto}
                </div>
              ) : (
                <div key={m.id} className="space-y-2 rounded-2xl rounded-tl-sm bg-muted/60 px-3 py-2" data-testid="resposta-suporte">
                  {m.r.aviso ? <p className="text-xs text-alerta">{m.r.aviso}</p> : null}
                  {m.r.modo === "ia" && m.r.resposta ? <p className="whitespace-pre-wrap">{m.r.resposta}</p> : null}
                  {m.r.modo === "guia" ? (
                    m.r.trechos.length ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Encontrei isto no guia do portal:</p>
                        {m.r.trechos.slice(0, m.r.atalhos.length ? 2 : 3).map((t) => (
                          <div key={t.titulo}>
                            <p className="font-medium">{t.titulo}</p>
                            <p className="text-muted-foreground">{t.texto}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>Não encontrei isso no guia do portal. Tente com outras palavras ou fale com o escritório.</p>
                    )
                  ) : m.r.trechos.length ? (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">De onde veio esta resposta</summary>
                      <ul className="mt-1 list-disc pl-4">
                        {m.r.trechos.map((t) => (
                          <li key={t.titulo}>{t.titulo}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {m.r.atalhos.length ? (
                    <div className="flex flex-col gap-1.5 pt-1">
                      {m.r.atalhos.map((a) => (
                        <Link
                          key={a.href}
                          href={a.href}
                          onClick={() => setAberto(false)}
                          className="inline-flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-card px-3 py-2 font-medium text-primary hover:bg-primary/10"
                        >
                          Ir para: {a.rotulo} <ArrowRight className="size-4 shrink-0" />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {(m.r.falarComEscritorio || m.avaliacao === false) && empresaId && podeSolicitar ? (
                    <Link href={linkSolicitacao(m.pergunta)} onClick={() => setAberto(false)} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
                      <MessageCircle className="size-3.5" /> Mandar esta dúvida ao escritório
                    </Link>
                  ) : null}
                  {m.r.guardada ? <p className="text-[11px] text-muted-foreground">Guardamos esta dúvida (sem números de documentos ou telefones) para o escritório completar o guia.</p> : null}
                  {m.r.registro ? (
                    m.avaliacao === undefined ? (
                      <div className="flex items-center gap-1.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground" data-testid="avaliar-suporte">
                        Isso ajudou?
                        <Button tamanho="sm" variante="fantasma" className="h-7 px-2" onClick={() => avaliar(m.id, true)} aria-label="Sim, ajudou">
                          <ThumbsUp /> Sim
                        </Button>
                        <Button tamanho="sm" variante="fantasma" className="h-7 px-2" onClick={() => avaliar(m.id, false)} aria-label="Não ajudou" title="A dúvida vai, sem números, para o escritório melhorar o guia">
                          <ThumbsDown /> Não
                        </Button>
                      </div>
                    ) : (
                      <p className="border-t border-border/60 pt-1.5 text-xs text-muted-foreground" data-testid="avaliado-suporte">
                        {m.avaliacao ? "Obrigado! Que bom que ajudou." : "Obrigado! A dúvida foi para o escritório melhorar o guia (sem números)."}
                      </p>
                    )
                  ) : null}
                </div>
              ),
            )}
            {pendente ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Procurando a resposta…
              </p>
            ) : null}
            <div ref={fim} />
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              perguntar(texto);
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={campo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    perguntar(texto);
                  }
                }}
                rows={2}
                maxLength={500}
                placeholder="Escreva sua dúvida… (ex.: como emito uma nota?)"
                aria-label="Sua dúvida"
                className="min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              <Button type="submit" tamanho="icone" disabled={pendente || texto.trim().length < 2} aria-label="Enviar dúvida">
                <Send />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              {empresaId && podeSolicitar ? (
                <Link href={`/e/${empresaId}/solicitacoes/nova?servico=outro`} onClick={() => setAberto(false)} className="underline-offset-2 hover:underline">
                  Falar com o escritório
                </Link>
              ) : (
                <span />
              )}
              {whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                  WhatsApp do escritório
                </a>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
              <span>Botão de ajuda: arraste para mudar de lugar, ou</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                onClick={() => mudarPosicao({ lado: ladoAtual === "esquerda" ? "direita" : "esquerda", baixo: posicao?.baixo ?? baixoMinimo() + 8 })}
              >
                <ArrowLeftRight className="size-3" /> {ladoAtual === "esquerda" ? "passar para a direita" : "passar para a esquerda"}
              </button>
              {posicao ? (
                <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => mudarPosicao(null)}>
                  <RotateCcw className="size-3" /> lugar padrão
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
