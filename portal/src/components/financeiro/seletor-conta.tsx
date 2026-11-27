"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, History, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizar } from "@/lib/financeiro/sugestao-conta";

export interface OpcaoConta {
  id: string;
  codigo: string;
  nome: string;
  grupo: string;
}

/**
 * Escolha da conta com busca: digita parte do nome ("alu") e escolhe; as mais
 * usadas aparecem como atalhos. Teclado: setas, Enter e Esc.
 */
export function SeletorConta({
  id,
  name,
  rotulo,
  opcoes,
  valor,
  aoMudar,
  maisUsadas = [],
  invalido,
}: {
  id: string;
  name: string;
  rotulo: string;
  opcoes: OpcaoConta[];
  valor: string;
  aoMudar: (id: string) => void;
  maisUsadas?: string[];
  invalido?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const listaId = useId();
  const selecionada = opcoes.find((o) => o.id === valor);

  const filtradas = useMemo(() => {
    const termos = normalizar(busca).split(" ").filter(Boolean);
    if (!termos.length) return opcoes;
    return opcoes.filter((o) => {
      const alvo = normalizar(`${o.codigo} ${o.nome} ${o.grupo}`);
      return termos.every((t) => alvo.includes(t));
    });
  }, [opcoes, busca]);

  useEffect(() => {
    if (!aberto) return;
    campoBusca.current?.focus();
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const escolher = (o: OpcaoConta) => {
    aoMudar(o.id);
    setAberto(false);
    setBusca("");
  };

  const atalhos = maisUsadas.map((i) => opcoes.find((o) => o.id === i)).filter((o): o is OpcaoConta => Boolean(o));

  return (
    <div ref={caixa} className="relative space-y-2">
      <input type="hidden" name={name} value={valor} />
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-haspopup="listbox"
        aria-label={selecionada ? `${rotulo}: ${selecionada.codigo} ${selecionada.nome}` : rotulo}
        aria-invalid={invalido || undefined}
        onClick={() => {
          setAberto((v) => !v);
          setAtivo(0);
        }}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          invalido && "border-perigo",
        )}
      >
        <span className={cn("truncate", !selecionada && "text-muted-foreground")}>{selecionada ? `${selecionada.codigo} ${selecionada.nome}` : "Escolha a conta…"}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {aberto ? (
        <div className="absolute inset-x-0 top-11 z-30 overflow-hidden rounded-lg border border-border bg-[var(--vidro-flutuante,var(--card))] shadow-lg backdrop-blur">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              ref={campoBusca}
              type="search"
              aria-label={`Buscar ${rotulo.toLowerCase()}`}
              aria-controls={listaId}
              aria-activedescendant={filtradas[ativo] ? `${listaId}-${filtradas[ativo].id}` : undefined}
              placeholder="Digite parte do nome, ex.: aluguel"
              className="h-10 w-full bg-transparent text-sm outline-none"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setAtivo(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtivo((a) => Math.min(a + 1, filtradas.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtivo((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtradas[ativo]) escolher(filtradas[ativo]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAberto(false);
                }
              }}
            />
          </div>
          <ul id={listaId} role="listbox" aria-label={rotulo} className="max-h-72 overflow-y-auto py-1">
            {filtradas.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma conta encontrada.</li> : null}
            {filtradas.map((o, i) => {
              const cabecalho = i === 0 || filtradas[i - 1].grupo !== o.grupo ? o.grupo : null;
              return (
                <li key={o.id} role="presentation">
                  {cabecalho ? <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cabecalho}</p> : null}
                  <div
                    id={`${listaId}-${o.id}`}
                    role="option"
                    aria-selected={o.id === valor}
                    className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm", i === ativo && "bg-muted")}
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => escolher(o)}
                  >
                    <span className="truncate">
                      <span className="text-muted-foreground">{o.codigo}</span> {o.nome}
                    </span>
                    {o.id === valor ? <Check className="size-4 shrink-0 text-primary" /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {atalhos.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Contas mais usadas">
          <span className="text-xs text-muted-foreground">Mais usadas:</span>
          {atalhos.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={o.id === valor}
              onClick={() => aoMudar(o.id)}
              className={cn(
                "max-w-[14rem] truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                o.id === valor ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border bg-background hover:border-primary/40",
              )}
            >
              {o.nome}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Aviso da sugestão de conta vinda do histórico. */
export function AvisoSugestao({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-1 text-xs text-primary">
      <History className="size-3.5" /> {texto}
    </p>
  );
}
