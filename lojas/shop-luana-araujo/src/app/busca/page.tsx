import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { arvoreCategorias, buscar, normalizar } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";
import { ListaProdutos } from "@/components/lista-produtos";

export const metadata: Metadata = { title: "Buscar", robots: { index: false } };

export default async function Busca({ searchParams }: PageProps<"/busca">) {
  const sp = await searchParams;
  const termo = (typeof sp.q === "string" ? sp.q : "").slice(0, 80).trim();
  const { categorias, produtos } = await obterVitrine();
  const achados = termo ? buscar(produtos, termo) : [];
  const arvore = arvoreCategorias(categorias, produtos);
  const categoriasAchadas = termo ? arvore.flatMap((c) => [c, ...c.filhas]).filter((c) => normalizar(c.nome).includes(normalizar(termo))).slice(0, 6) : [];
  return (
    <div className="conteudo pt-8 md:pt-12">
      <h1 className="text-4xl md:text-5xl">{termo ? `Busca: “${termo}”` : "Buscar"}</h1>
      <form action="/busca" role="search" className="mt-6 max-w-xl">
        <label htmlFor="busca" className="sr-only">
          O que você procura?
        </label>
        <div className="flex border-b border-tinta">
          <input id="busca" name="q" type="search" defaultValue={termo} autoFocus={!termo} placeholder="Ex.: brinco prata, base, gloss" className="min-h-12 flex-1 bg-transparent px-1 text-base focus:outline-none" />
          <button type="submit" className="inline-flex size-12 items-center justify-center" aria-label="Buscar">
            <Search className="size-5" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </form>
      {categoriasAchadas.length ? (
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Categorias encontradas">
          {categoriasAchadas.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="opcao">
                {c.nome}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-10">
        {termo && !achados.length ? (
          <div className="border-t border-linha py-16 text-center">
            <p className="font-titulo text-2xl">Nenhum produto com “{termo}”</p>
            <p className="mt-2 text-sm text-suave">Tente outra palavra, como a marca ou o tipo do produto.</p>
          </div>
        ) : termo ? (
          <ListaProdutos key={termo} produtos={achados} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {arvore.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="opcao">
                {c.nome}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
