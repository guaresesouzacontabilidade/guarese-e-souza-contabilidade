import Link from "next/link";
import { Search } from "lucide-react";
import type { NoCategoria } from "@/lib/catalogo";
import type { Loja } from "@/lib/tipos";
import { Logo } from "./logo";
import { BotaoSacola } from "./botao-sacola";
import { MenuCategorias } from "./menu-movel";

export function Cabecalho({ loja, arvore }: { loja: Loja; arvore: NoCategoria[] }) {
  const principais = arvore.slice(0, 5);
  return (
    <>
      {loja.aviso ? (
        <div className="no-escuro bg-noite px-3 py-2 text-center text-[0.625rem] font-medium uppercase tracking-[0.1em] text-prata sm:text-[0.6875rem] sm:tracking-[0.16em]">{loja.aviso}</div>
      ) : null}
      <header className="no-escuro sticky top-0 z-40 border-b border-white/10 bg-tinta" style={{ viewTransitionName: "cabecalho" }}>
        <div className="conteudo grid h-16 grid-cols-[auto_1fr_auto] items-center gap-2 md:h-20 md:grid-cols-[auto_1fr_auto] md:gap-8">
          <div className="flex items-center md:hidden">
            <MenuCategorias arvore={arvore} />
          </div>
          <Logo nome={loja.nome} className="justify-self-center md:justify-self-start" />
          <nav className="hidden items-center justify-center gap-5 md:flex lg:gap-7" aria-label="Principais categorias">
            {principais.map((c, i) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className={`whitespace-nowrap py-2 text-[0.75rem] font-medium uppercase tracking-[0.14em] text-prata transition-colors hover:text-white ${i >= 2 ? "hidden lg:inline" : ""} ${i >= 4 ? "lg:hidden xl:inline" : ""}`}
              >
                {c.nome}
              </Link>
            ))}
            {arvore.length > 2 ? <MenuCategorias arvore={arvore} rotulo="Todas" variante="texto" /> : null}
          </nav>
          <div className="flex items-center justify-end gap-1">
            <form action="/busca" role="search" className="hidden lg:block">
              <label htmlFor="busca-topo" className="sr-only">
                Buscar produtos
              </label>
              <div className="flex h-10 items-center border-b border-white/25 focus-within:border-prata">
                <input
                  id="busca-topo"
                  name="q"
                  type="search"
                  placeholder="Buscar produtos"
                  className="w-44 bg-transparent px-1 text-sm text-white placeholder:text-prata-media focus:outline-none"
                />
                <button type="submit" className="inline-flex size-9 items-center justify-center text-prata hover:text-white" aria-label="Buscar">
                  <Search className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            </form>
            <Link href="/busca" className="inline-flex size-11 items-center justify-center text-prata hover:text-white lg:hidden" aria-label="Buscar produtos">
              <Search className="size-[22px]" strokeWidth={1.5} aria-hidden="true" />
            </Link>
            <BotaoSacola />
          </div>
        </div>
      </header>
    </>
  );
}
