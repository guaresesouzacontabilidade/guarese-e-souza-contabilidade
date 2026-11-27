"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { linkWhatsApp, moeda } from "@/lib/catalogo";
import { useSacola } from "@/lib/sacola";
import type { ProdutoDetalhe } from "@/lib/tipos";
import { IconeWhatsApp } from "./icones";

type Props = {
  produto: Pick<ProdutoDetalhe, "id" | "nome" | "preco" | "preco_de" | "disponivel" | "maximo" | "variacoes" | "rotulo_variacao" | "fotos">;
  url: string;
  whatsapp: string | null;
  enderecoSite: string | null;
};

/** Escolha da opção (cor, tom, tamanho), quantidade e "Adicionar à sacola" — com barra fixa no celular. */
export function Comprar({ produto: p, url, whatsapp, enderecoSite }: Props) {
  const sacola = useSacola();
  const [variacao, setVariacao] = React.useState<string | null>(p.variacoes.length === 1 ? p.variacoes[0] : null);
  const [quantidade, setQuantidade] = React.useState(1);
  const [erro, setErro] = React.useState<string | null>(null);
  const [botaoVisivel, setBotaoVisivel] = React.useState(true);
  const botao = React.useRef<HTMLButtonElement>(null);
  const opcoes = React.useRef<HTMLDivElement>(null);
  const rotulo = p.rotulo_variacao || "Opção";
  const pedirOpcao = rotulo.toLowerCase() === "opção" ? "Escolha uma opção" : `Escolha uma opção de ${rotulo.toLowerCase()}`;
  const maximo = Math.max(1, p.maximo);

  React.useEffect(() => {
    const el = botao.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setBotaoVisivel(e.isIntersecting), { rootMargin: "0px 0px -40px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const adicionar = () => {
    if (!p.disponivel) return;
    if (p.variacoes.length && !variacao) {
      setErro(`${pedirOpcao} antes de pôr na sacola.`);
      opcoes.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      opcoes.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      return;
    }
    setErro(null);
    sacola.adicionar({
      produto_id: p.id,
      variacao,
      rotulo_variacao: p.variacoes.length ? rotulo : null,
      quantidade,
      nome: p.nome,
      preco: p.preco,
      foto: p.fotos[0] ?? null,
      url,
      maximo,
    });
    setQuantidade(1);
  };

  const duvida = whatsapp
    ? linkWhatsApp(whatsapp, `Olá! Tenho uma dúvida sobre ${p.nome}${variacao ? ` (${rotulo}: ${variacao})` : ""}. ${enderecoSite ? enderecoSite + url : ""}`.trim())
    : null;

  return (
    <div>
      {p.variacoes.length ? (
        <fieldset className="mt-8">
          <legend className="text-sm">
            <span className="font-medium">{rotulo}</span>
            {variacao ? <span className="text-suave">: {variacao}</span> : <span className="text-suave"> — escolha uma</span>}
          </legend>
          <div ref={opcoes} role="radiogroup" aria-label={rotulo} aria-describedby={erro ? "erro-opcao" : undefined} className="mt-3 flex flex-wrap gap-2">
            {p.variacoes.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={variacao === v}
                onClick={() => {
                  setVariacao(v);
                  setErro(null);
                }}
                className="opcao"
              >
                {v}
              </button>
            ))}
          </div>
          {erro ? (
            <p id="erro-opcao" className="mt-2 text-sm text-erro" role="alert">
              {erro}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {p.disponivel ? (
        <div className="mt-8 flex flex-wrap items-stretch gap-3">
          <div className="flex items-center border border-borda" role="group" aria-label="Quantidade">
            <button type="button" className="inline-flex size-12 items-center justify-center disabled:text-borda" onClick={() => setQuantidade((q) => Math.max(1, q - 1))} disabled={quantidade <= 1} aria-label="Diminuir a quantidade">
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <output className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">
              {quantidade}
            </output>
            <button type="button" className="inline-flex size-12 items-center justify-center disabled:text-borda" onClick={() => setQuantidade((q) => Math.min(maximo, q + 1))} disabled={quantidade >= maximo} aria-label="Aumentar a quantidade">
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
          <button ref={botao} type="button" onClick={adicionar} className="botao flex-1 basis-56">
            Adicionar à sacola
          </button>
        </div>
      ) : (
        <div className="mt-8">
          <button type="button" disabled className="botao w-full">
            Esgotado
          </button>
          <p className="mt-3 text-sm text-suave">Quer saber quando volta? Pergunte no WhatsApp da loja.</p>
        </div>
      )}
      {p.disponivel && quantidade >= maximo && maximo < 99 ? <p className="mt-2 text-xs text-suave">Temos {maximo} em estoque.</p> : null}

      {duvida ? (
        <a href={duvida} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-suave underline-offset-4 hover:text-texto hover:underline">
          <IconeWhatsApp className="size-4" /> Tirar dúvida pelo WhatsApp
        </a>
      ) : null}

      {/* Barra fixa no celular quando o botão sai da tela */}
      {p.disponivel ? (
        <div
          className={`fixed inset-x-0 bottom-0 z-40 border-t border-linha bg-superficie/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform duration-200 md:hidden ${botaoVisivel ? "translate-y-full" : "translate-y-0"}`}
          aria-hidden={botaoVisivel}
        >
          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="truncate text-xs text-suave">{variacao ? `${rotulo}: ${variacao}` : p.variacoes.length ? pedirOpcao : p.nome}</p>
              <p className="text-base font-semibold tabular-nums">{moeda(p.preco)}</p>
            </div>
            <button type="button" onClick={adicionar} className="botao flex-1" tabIndex={botaoVisivel ? -1 : 0}>
              Adicionar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
