import Image from "next/image";
import Link from "next/link";
import { linkWhatsApp, urlProduto } from "@/lib/catalogo";
import type { ProdutoResumo } from "@/lib/tipos";
import { IconeWhatsApp } from "./icones";

export type ModeloAbertura = "fotos-em-linha" | "faixa-preta" | "so-texto";

type Props = {
  modelo: ModeloAbertura;
  cidade: string | null;
  frase: string;
  whatsapp: string | null;
  fotos: Pick<ProdutoResumo, "id" | "nome" | "fotos">[];
};

const TEXTO = "Escolha pelo site e envie o pedido. A conversa no WhatsApp da loja já abre com tudo anotado.";

function Botoes({ whatsapp, escuro = false }: { whatsapp: string | null; escuro?: boolean }) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="#novidades" className={escuro ? "botao bg-white px-5 text-tinta hover:bg-prata" : "botao px-5"}>
        Ver novidades
      </Link>
      {whatsapp ? (
        <a
          href={linkWhatsApp(whatsapp, "Olá! Vim pelo site da loja.")}
          className={escuro ? "botao-contorno border-prata px-5 text-prata hover:bg-white hover:text-tinta" : "botao-contorno px-5"}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconeWhatsApp className="size-4" /> WhatsApp
        </a>
      ) : null}
    </div>
  );
}

/** Abertura da página inicial: o que a loja vende e como comprar, com as fotos dos próprios produtos. */
export function Abertura({ modelo, cidade, frase, whatsapp, fotos }: Props) {
  if (modelo === "faixa-preta") {
    // Painel preto da marca com o texto e uma foto ao lado (no celular, a foto fica em cima)
    const foto = fotos[0];
    return (
      <section className="no-escuro bg-noite text-prata">
        <div className="conteudo grid items-center gap-0 md:grid-cols-[1.15fr_1fr]">
          <div className="order-2 py-8 md:order-1 md:py-12 md:pr-10">
            {cidade ? <p className="sobretitulo text-prata-media">{cidade}</p> : null}
            <h1 className="mt-3 text-[2.1rem] leading-[1.06] text-white md:text-5xl">{frase}</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-prata-media md:text-[0.9375rem]">{TEXTO}</p>
            <Botoes whatsapp={whatsapp} escuro />
          </div>
          {foto ? (
            <Link href={urlProduto(foto)} aria-label={foto.nome} className="relative order-1 -mx-4 block h-56 overflow-hidden md:order-2 md:mx-0 md:h-[22rem]">
              <Image src={foto.fotos[0]} alt="" fill priority sizes="(min-width: 768px) 45vw, 100vw" className="object-cover object-[50%_25%]" />
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  if (modelo === "so-texto") {
    // Só o texto, curto: as fotos aparecem logo abaixo, nas categorias
    return (
      <section className="border-b border-linha bg-superficie">
        <div className="conteudo flex flex-col gap-5 py-8 md:flex-row md:items-end md:justify-between md:py-12">
          <div className="max-w-2xl">
            {cidade ? <p className="sobretitulo">{cidade}</p> : null}
            <h1 className="mt-3 text-[2.1rem] leading-[1.06] md:text-5xl">{frase}</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-suave md:text-[0.9375rem]">{TEXTO}</p>
          </div>
          <div className="shrink-0 [&>div]:mt-0">
            <Botoes whatsapp={whatsapp} />
          </div>
        </div>
      </section>
    );
  }

  // "fotos-em-linha": texto à esquerda e três fotos numa linha, baixas
  return (
    <section className="border-b border-linha bg-superficie">
      <div className="conteudo grid items-center gap-6 py-8 md:grid-cols-[1fr_1.1fr] md:gap-12 md:py-10">
        <div>
          {cidade ? <p className="sobretitulo">{cidade}</p> : null}
          <h1 className="mt-3 text-[2.1rem] leading-[1.06] md:text-5xl">{frase}</h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-suave md:text-[0.9375rem]">{TEXTO}</p>
          <Botoes whatsapp={whatsapp} />
        </div>
        {fotos.length >= 3 ? (
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {fotos.slice(0, 3).map((p) => (
              <Link key={p.id} href={urlProduto(p)} aria-label={p.nome} className="group relative aspect-[4/5] overflow-hidden bg-areia">
                <Image src={p.fotos[0]} alt="" fill priority sizes="(min-width: 768px) 16vw, 31vw" className="object-cover transition duration-700 ease-out group-hover:scale-[1.03]" />
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
