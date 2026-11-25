"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, BookOpen, Bot, LifeBuoy, Loader2, MessageCircle, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
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
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls="painel-suporte"
        aria-label={aberto ? "Fechar o suporte" : "Abrir o suporte 24h"}
        className={cn("fixed right-4 z-40 h-12 rounded-full px-4 shadow-lg lg:bottom-6", comBarraInferior ? "bottom-[5.5rem]" : "bottom-5")}
        data-testid="botao-suporte"
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
            "fixed inset-x-0 z-40 flex flex-col overflow-hidden border border-border bg-card shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[24rem] sm:rounded-2xl lg:bottom-[5.25rem]",
            comBarraInferior ? "bottom-[9rem] top-16 rounded-t-2xl sm:top-auto sm:max-h-[70dvh]" : "bottom-[4.5rem] top-16 rounded-t-2xl sm:top-auto sm:max-h-[70dvh]",
          )}
          data-testid="painel-suporte"
        >
          <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="font-semibold">Suporte 24h</p>
              <p className="text-xs text-muted-foreground">Dúvidas sobre como usar o portal, a qualquer hora.</p>
            </div>
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
          </form>
        </section>
      ) : null}
    </div>
  );
}
