import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { arvoreCategorias, linkWhatsApp, ordenar, produtosDaCategoria, urlProduto, valorEntrega, type NoCategoria } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";
import { frasePrincipal } from "@/lib/textos";
import type { ProdutoResumo } from "@/lib/tipos";
import { CartaoProduto } from "@/components/cartao-produto";
import { IconeWhatsApp } from "@/components/icones";

export const revalidate = 60;

function Prateleira({ titulo, sobretitulo, href, produtos }: { titulo: string; sobretitulo?: string; href?: string; produtos: ProdutoResumo[] }) {
  if (!produtos.length) return null;
  return (
    <section className="conteudo mt-20 md:mt-28" aria-labelledby={`prat-${titulo}`}>
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          {sobretitulo ? <p className="sobretitulo">{sobretitulo}</p> : null}
          <h2 id={`prat-${titulo}`} className="mt-2 text-3xl md:text-4xl">
            {titulo}
          </h2>
        </div>
        {href ? (
          <Link href={href} className="group inline-flex shrink-0 items-center gap-1.5 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
            Ver tudo <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <ul className="faixa-rolagem scroll-px-4 -mx-4 gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        {produtos.map((p) => (
          <li key={p.id} className="w-[44vw] sm:w-auto">
            <CartaoProduto produto={p} tamanhos="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 44vw" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function fotoDaCategoria(c: NoCategoria, produtos: ProdutoResumo[], usadas: Set<string>) {
  const candidatos = ordenar(produtosDaCategoria(c, produtos), "destaque").filter((p) => p.fotos.length && p.disponivel);
  const escolhido = candidatos.find((p) => !usadas.has(p.fotos[0])) ?? candidatos[0];
  if (escolhido) usadas.add(escolhido.fotos[0]);
  return escolhido?.fotos[0] ?? null;
}

export default async function Inicio() {
  const { loja, categorias, produtos } = await obterVitrine();
  const arvore = arvoreCategorias(categorias, produtos);
  const comFoto = produtos.filter((p) => p.fotos.length && p.disponivel);
  const vitrine = ordenar(comFoto, "destaque");
  const mosaico = vitrine.slice(0, 3);
  const novidades = ordenar(comFoto, "novos").slice(0, 8);
  const destaques = comFoto.filter((p) => p.destaque).slice(0, 8);
  const maiores = [...arvore].sort((a, b) => b.total - a.total).slice(0, 3);
  const frase = frasePrincipal(arvore);
  const usadas = new Set(mosaico.map((p) => p.fotos[0]));

  return (
    <>
      {/* Abertura: o que a loja vende, como comprar e as fotos dos próprios produtos */}
      <section className="border-b border-linha bg-superficie">
        <div className="conteudo grid items-center gap-10 py-10 md:grid-cols-[1fr_1.05fr] md:gap-14 md:py-16 lg:py-20">
          <div className="max-w-xl">
            {loja.cidade ? <p className="sobretitulo">{loja.cidade}</p> : null}
            <h1 className="mt-4 text-[2.5rem] leading-[1.05] md:text-6xl">{frase || loja.nome}</h1>
            <p className="mt-5 max-w-md text-[0.9375rem] leading-relaxed text-suave md:text-base">
              Escolha pelo site e envie o pedido. A conversa no WhatsApp da loja já abre com tudo anotado para combinar o pagamento e a entrega.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:flex">
              <Link href="#novidades" className="botao px-4">
                Ver novidades
              </Link>
              {loja.whatsapp ? (
                <a href={linkWhatsApp(loja.whatsapp, "Olá! Vim pelo site da loja.")} className="botao-contorno px-4" target="_blank" rel="noopener noreferrer">
                  <IconeWhatsApp className="size-4" /> WhatsApp
                </a>
              ) : null}
            </div>
          </div>
          {mosaico.length === 3 ? (
            <div className="grid grid-cols-[1.25fr_1fr] gap-2.5 md:gap-3">
              {mosaico.map((p, i) => (
                <Link
                  key={p.id}
                  href={urlProduto(p)}
                  className={`group relative overflow-hidden bg-areia ${i === 0 ? "row-span-2 aspect-[4/5] md:aspect-auto" : "aspect-square"}`}
                  aria-label={p.nome}
                >
                  <Image src={p.fotos[0]} alt="" fill priority sizes="(min-width: 768px) 30vw, 55vw" className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]" />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Entregas: informação real da loja, cadastrada no portal */}
      {loja.entregas.length ? (
        <section aria-label="Formas de entrega" className="border-b border-linha">
          <ul className="conteudo grid grid-cols-2 gap-x-4 gap-y-5 py-6 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-linha lg:py-0">
            {loja.entregas.slice(0, 4).map((e) => (
              <li key={e.id} className="lg:px-6 lg:py-5 lg:first:pl-0">
                <p className="text-[0.8125rem] font-medium leading-snug sm:text-sm">{e.nome}</p>
                <p className="mt-0.5 text-xs font-semibold tabular-nums">{valorEntrega(e)}</p>
                {e.detalhe ? <p className="mt-1 text-xs leading-relaxed text-suave">{e.detalhe}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Categorias */}
      {arvore.length ? (
        <section className="conteudo mt-16 md:mt-24" aria-labelledby="titulo-categorias">
          <p className="sobretitulo">Categorias</p>
          <h2 id="titulo-categorias" className="mt-2 text-3xl md:text-4xl">
            Compre por categoria
          </h2>
          <ul className="faixa-rolagem scroll-px-4 -mx-4 mt-8 gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-x-5 sm:gap-y-8 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {arvore.slice(0, 8).map((c) => {
              const foto = fotoDaCategoria(c, produtos, usadas);
              return (
                <li key={c.id} className="w-[38vw] sm:w-auto">
                  <Link href={`/c/${c.slug}`} className="group block">
                    <div className="relative aspect-square overflow-hidden bg-areia sm:aspect-[4/5]">
                      {foto ? <Image src={foto} alt="" fill sizes="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 38vw" className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]" /> : null}
                    </div>
                    <p className="mt-3 flex items-baseline justify-between gap-2">
                      <span className="font-titulo text-lg leading-tight sm:text-xl md:text-2xl">{c.nome}</span>
                      <span className="text-xs tabular-nums text-suave">{c.total}</span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          {arvore.length > 8 ? (
            <ul className="mt-8 flex flex-wrap gap-2" aria-label="Outras categorias">
              {arvore.slice(8).map((c) => (
                <li key={c.id}>
                  <Link href={`/c/${c.slug}`} className="opcao">
                    {c.nome}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div id="novidades" className="scroll-mt-24">
        <Prateleira titulo="Novidades" sobretitulo="Acabou de chegar" produtos={novidades} />
      </div>
      <Prateleira titulo="Destaques" sobretitulo="Escolhidos pela loja" produtos={destaques} />
      {maiores.map((c) => (
        <Prateleira key={c.id} titulo={c.nome} href={`/c/${c.slug}`} produtos={ordenar(produtosDaCategoria(c, comFoto), "destaque").slice(0, 8)} />
      ))}

      {/* Como comprar */}
      <section className="conteudo mt-24 md:mt-32" aria-labelledby="como-comprar">
        <div className="border-t border-tinta pt-10">
          <p className="sobretitulo">Simples e pelo WhatsApp</p>
          <h2 id="como-comprar" className="mt-2 text-3xl md:text-4xl">
            Como comprar
          </h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-12">
            {[
              ["Escolha", "Veja as fotos, escolha a cor ou o tom e coloque na sacola."],
              ["Envie o pedido", "Na sacola, diga como quer receber e como prefere pagar. O pedido chega na hora para a loja."],
              ["Combine no WhatsApp", "A conversa abre com o resumo pronto. É só confirmar o pagamento e a entrega."],
            ].map(([titulo, texto], i) => (
              <li key={titulo} className="grid grid-cols-[auto_1fr] gap-x-5">
                <span className="font-titulo text-5xl leading-none text-prata-media" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-sans text-sm font-semibold uppercase tracking-[0.12em]">{titulo}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-suave">{texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
