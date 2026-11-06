import Image from "next/image";
import Link from "next/link";
import { linkWhatsApp, urlProduto } from "@/lib/catalogo";
import type { ProdutoResumo } from "@/lib/tipos";
import { IconeWhatsApp } from "./icones";

/**
 * Abertura da página inicial (modelo "faixa preta", escolhido pela loja): painel
 * preto da marca com o que a loja vende e como comprar, e uma foto grande de um
 * produto ao lado. No celular, a foto fica em cima. A foto é a do primeiro
 * produto em destaque com foto (marque "Destaque" no portal para escolher).
 */
export function Abertura({
  cidade,
  frase,
  whatsapp,
  foto,
}: {
  cidade: string | null;
  frase: string;
  whatsapp: string | null;
  foto: Pick<ProdutoResumo, "id" | "nome" | "fotos"> | null;
}) {
  return (
    <section className="no-escuro bg-noite text-prata">
      <div className="conteudo grid items-center md:grid-cols-[1.15fr_1fr]">
        <div className="order-2 py-8 md:order-1 md:py-12 md:pr-10">
          {cidade ? <p className="sobretitulo text-prata-media">{cidade}</p> : null}
          <h1 className="mt-3 text-[2.1rem] leading-[1.06] text-white md:text-5xl">{frase}</h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-prata-media md:text-[0.9375rem]">
            Escolha pelo site e envie o pedido. A conversa no WhatsApp da loja já abre com tudo anotado.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="#novidades" className="botao bg-white px-5 text-tinta hover:bg-prata">
              Ver novidades
            </Link>
            {whatsapp ? (
              <a
                href={linkWhatsApp(whatsapp, "Olá! Vim pelo site da loja.")}
                className="botao-contorno border-prata px-5 text-prata hover:bg-white hover:text-tinta"
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconeWhatsApp className="size-4" /> WhatsApp
              </a>
            ) : null}
          </div>
        </div>
        {foto?.fotos[0] ? (
          <Link href={urlProduto(foto)} aria-label={foto.nome} className="group relative order-1 -mx-4 block h-56 overflow-hidden md:order-2 md:mx-0 md:h-[22rem]">
            <Image
              src={foto.fotos[0]}
              alt=""
              fill
              priority
              sizes="(min-width: 768px) 45vw, 100vw"
              className="object-cover object-[50%_25%] transition duration-700 ease-out group-hover:scale-[1.02]"
            />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
