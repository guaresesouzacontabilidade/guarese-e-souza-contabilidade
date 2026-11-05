import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { arvoreCategorias, moeda, ordenar, produtosDaCategoria, urlProduto, valorEntrega } from "@/lib/catalogo";
import { obterProduto, obterVitrine } from "@/lib/portal";
import { CartaoProduto } from "@/components/cartao-produto";
import { Comprar } from "@/components/comprar";
import { Galeria } from "@/components/galeria";

export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

function resumoTexto(texto: string | null, max = 155) {
  if (!texto) return undefined;
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export async function generateMetadata({ params }: PageProps<"/p/[id]/[[...nome]]">): Promise<Metadata> {
  const p = await obterProduto((await params).id);
  if (!p) return {};
  const descricao = resumoTexto(p.descricao) ?? `${p.nome} por ${moeda(p.preco)}.`;
  const foto = p.fotos[0] ? `${p.fotos[0]}-g.webp` : undefined;
  return {
    title: p.nome,
    description: descricao,
    alternates: { canonical: urlProduto(p) },
    openGraph: { title: `${p.nome} — ${moeda(p.preco)}`, description: descricao, images: foto ? [{ url: foto, width: 1200, height: 1200 }] : undefined },
  };
}

export default async function PaginaProduto({ params }: PageProps<"/p/[id]/[[...nome]]">) {
  const { id } = await params;
  const [p, { loja, categorias, produtos }] = await Promise.all([obterProduto(id), obterVitrine()]);
  if (!p) notFound();
  const arvore = arvoreCategorias(categorias, produtos);
  const pai = arvore.find((c) => c.id === p.categoria_id || c.filhas.some((f) => f.id === p.categoria_id)) ?? null;
  const sub = pai?.filhas.find((f) => f.id === p.categoria_id) ?? null;
  const parecidos = pai
    ? ordenar(produtosDaCategoria(sub ?? pai, produtos).filter((x) => x.id !== p.id && x.disponivel && x.fotos.length), "destaque").slice(0, 8)
    : [];
  const url = urlProduto(p);
  const promocao = p.preco_de && p.preco_de > p.preco;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? loja.endereco_site ?? "").replace(/\/$/, "");

  const dadosEstruturados = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.nome,
    sku: p.codigo,
    image: p.fotos.map((f) => `${f}-g.webp`),
    description: resumoTexto(p.descricao, 500),
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: p.preco.toFixed(2),
      availability: p.disponivel ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: site ? `${site}${url}` : undefined,
      seller: { "@type": "Organization", name: loja.nome },
    },
  };

  return (
    <div className="pb-24 md:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dadosEstruturados).replace(/</g, "\\u003c") }} />
      <div className="md:conteudo md:pt-8">
        <nav aria-label="Você está em" className="conteudo hidden pb-6 text-xs text-suave md:block md:px-0">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-texto">
                Início
              </Link>
            </li>
            {pai ? (
              <>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={`/c/${pai.slug}`} className="hover:text-texto">
                    {pai.nome}
                  </Link>
                </li>
              </>
            ) : null}
            {sub ? (
              <>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={`/c/${sub.slug}`} className="hover:text-texto">
                    {sub.nome}
                  </Link>
                </li>
              </>
            ) : null}
          </ol>
        </nav>
        <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
          <Galeria fotos={p.fotos} nome={p.nome} />
          <div className="conteudo md:px-0">
            <div className="md:sticky md:top-28">
              {sub || pai ? (
                <Link href={`/c/${(sub ?? pai)!.slug}`} className="sobretitulo hover:text-texto">
                  {(sub ?? pai)!.nome}
                </Link>
              ) : null}
              <h1 className="mt-3 text-[2rem] leading-tight md:text-[2.5rem]">{p.nome}</h1>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-3">
                {promocao ? (
                  <s className="text-base text-suave">
                    <span className="sr-only">de </span>
                    {moeda(p.preco_de as number)}
                  </s>
                ) : null}
                <span className="text-2xl font-semibold tabular-nums">
                  {promocao ? <span className="sr-only">por </span> : null}
                  {moeda(p.preco)}
                </span>
              </p>
              {p.disponivel ? (
                p.ultimas ? (
                  <p className="mt-2 text-sm font-medium text-alerta">Últimas unidades</p>
                ) : (
                  <p className="mt-2 text-sm text-sucesso">Disponível</p>
                )
              ) : (
                <p className="mt-2 text-sm font-medium text-erro">Esgotado no momento</p>
              )}

              <Comprar
                produto={p}
                url={url}
                whatsapp={loja.whatsapp}
                enderecoSite={site || null}
              />

              {loja.entregas.length ? (
                <div className="mt-10 border-t border-linha pt-6">
                  <h2 className="font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.18em]">Entrega</h2>
                  <ul className="mt-3 space-y-2 text-sm">
                    {loja.entregas.map((e) => (
                      <li key={e.id} className="flex justify-between gap-4">
                        <span className="text-suave">{e.nome}</span>
                        <span className="shrink-0 tabular-nums">{valorEntrega(e)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {p.descricao ? (
                <div className="mt-8 border-t border-linha pt-6">
                  <h2 className="font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.18em]">Descrição</h2>
                  <p className="texto-corrido mt-3">{p.descricao}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {parecidos.length ? (
        <section className="conteudo mt-20 md:mt-28" aria-labelledby="parecidos">
          <h2 id="parecidos" className="text-3xl md:text-4xl">
            Você também pode gostar
          </h2>
          <ul className="faixa-rolagem scroll-px-4 -mx-4 mt-7 gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-x-5 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {parecidos.map((x) => (
              <li key={x.id} className="w-[44vw] sm:w-auto">
                <CartaoProduto produto={x} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
