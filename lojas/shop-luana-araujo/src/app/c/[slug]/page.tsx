import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acharCategoria, arvoreCategorias, produtosDaCategoria } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";
import { ListaProdutos } from "@/components/lista-produtos";
import { Subcategorias } from "@/components/subcategorias";

export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

async function dados(slug: string) {
  const { categorias, produtos } = await obterVitrine();
  const arvore = arvoreCategorias(categorias, produtos);
  const achada = acharCategoria(arvore, slug);
  if (!achada) return null;
  return { ...achada, produtos: produtosDaCategoria(achada.categoria, produtos) };
}

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const d = await dados((await params).slug);
  if (!d) return {};
  const nome = d.pai ? `${d.categoria.nome} · ${d.pai.nome}` : d.categoria.nome;
  return { title: nome, description: `${d.categoria.total} produtos em ${nome}.`, alternates: { canonical: `/c/${d.categoria.slug}` } };
}

export default async function PaginaCategoria({ params }: PageProps<"/c/[slug]">) {
  const d = await dados((await params).slug);
  if (!d) notFound();
  const { categoria, pai, produtos } = d;
  const principal = pai ?? categoria;
  return (
    <div className="conteudo pt-8 md:pt-12">
      <nav aria-label="Você está em" className="text-xs text-suave">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-texto">
              Início
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          {pai ? (
            <>
              <li>
                <Link href={`/c/${pai.slug}`} className="hover:text-texto">
                  {pai.nome}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
            </>
          ) : null}
          <li aria-current="page" className="text-texto">
            {categoria.nome}
          </li>
        </ol>
      </nav>
      <h1 className="mt-4 text-4xl md:text-5xl">{categoria.nome}</h1>
      {principal.filhas.length ? (
        <Subcategorias
          principal={{ slug: principal.slug, nome: principal.nome }}
          filhas={principal.filhas.map((f) => ({ id: f.id, nome: f.nome, slug: f.slug }))}
          atual={pai ? categoria.id : null}
        />
      ) : null}
      <div className="mt-8">
        <ListaProdutos key={categoria.id} produtos={produtos} />
      </div>
    </div>
  );
}
