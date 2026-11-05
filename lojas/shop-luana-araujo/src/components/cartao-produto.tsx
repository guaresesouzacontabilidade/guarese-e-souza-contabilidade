import Image from "next/image";
import Link from "next/link";
import { moeda, urlProduto } from "@/lib/catalogo";
import type { ProdutoResumo } from "@/lib/tipos";

/** Cartão do produto: foto quadrada (a segunda foto aparece ao passar o mouse), nome e preço. */
export function CartaoProduto({ produto: p, prioridade = false, tamanhos = "(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw" }: { produto: ProdutoResumo; prioridade?: boolean; tamanhos?: string }) {
  const [foto, segunda] = p.fotos;
  const promocao = p.preco_de && p.preco_de > p.preco;
  return (
    <article className="group relative">
      <div className="relative aspect-square overflow-hidden bg-areia">
        {foto ? (
          <>
            <Image
              src={foto}
              alt=""
              fill
              sizes={tamanhos}
              priority={prioridade}
              className={`object-cover transition duration-500 ease-out group-hover:scale-[1.03] ${!p.disponivel ? "opacity-60 grayscale-[35%]" : ""} ${segunda ? "group-hover:opacity-0" : ""}`}
            />
            {segunda ? <Image src={segunda} alt="" fill sizes={tamanhos} className="object-cover opacity-0 transition duration-500 ease-out group-hover:opacity-100" /> : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center font-titulo text-2xl text-prata-media" aria-hidden="true">
            Foto em breve
          </div>
        )}
        {!p.disponivel ? (
          <span className="absolute left-2 top-2 bg-superficie/95 px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-texto">Esgotado</span>
        ) : promocao ? (
          <span className="absolute left-2 top-2 bg-tinta px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-white">Promoção</span>
        ) : null}
      </div>
      <h3 className="mt-3 line-clamp-2 font-sans text-[0.8125rem] font-normal leading-snug text-texto sm:text-sm">
        <Link href={urlProduto(p)} className="after:absolute after:inset-0 after:content-['']">
          {p.nome}
        </Link>
      </h3>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        {promocao ? (
          <s className="text-xs text-suave">
            <span className="sr-only">de </span>
            {moeda(p.preco_de as number)}
          </s>
        ) : null}
        <span className="font-semibold tabular-nums">
          {promocao ? <span className="sr-only">por </span> : null}
          {moeda(p.preco)}
        </span>
      </p>
      {p.disponivel && p.ultimas ? <p className="mt-1 text-xs font-medium text-alerta">Últimas unidades</p> : null}
      {p.disponivel && !p.ultimas && p.opcoes > 1 ? <p className="mt-1 text-xs text-suave">{p.opcoes} opções</p> : null}
    </article>
  );
}

export function GradeProdutos({ produtos, prioridade = 0 }: { produtos: ProdutoResumo[]; prioridade?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-y-12">
      {produtos.map((p, i) => (
        <li key={p.id}>
          <CartaoProduto produto={p} prioridade={i < prioridade} />
        </li>
      ))}
    </ul>
  );
}
