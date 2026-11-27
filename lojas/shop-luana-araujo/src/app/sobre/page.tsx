import type { Metadata } from "next";
import Link from "next/link";
import { linkWhatsApp, telefoneVisivel, valorEntrega } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";

export const metadata: Metadata = { title: "Sobre a loja" };
export const revalidate = 60;

export default async function Sobre() {
  const { loja } = await obterVitrine();
  return (
    <article className="conteudo max-w-3xl pt-10 md:pt-16">
      <p className="sobretitulo">Sobre</p>
      <h1 className="mt-3 text-4xl md:text-5xl">{loja.nome}</h1>
      {loja.sobre ? <p className="texto-corrido mt-6 text-base">{loja.sobre}</p> : null}

      <section id="como-comprar" className="mt-14 scroll-mt-28 border-t border-linha pt-8">
        <h2 className="text-3xl">Como comprar</h2>
        <ol className="mt-5 list-decimal space-y-3 pl-5 text-[0.9375rem] leading-relaxed marker:text-suave">
          <li>Escolha os produtos e, quando houver, a cor, o tom ou o tamanho.</li>
          <li>Na sacola, informe seu nome, seu WhatsApp, a forma de entrega e como prefere pagar.</li>
          <li>Envie o pedido: ele chega na hora para a loja, com um número.</li>
          <li>A conversa no WhatsApp abre com o resumo pronto. É lá que vocês combinam o pagamento e a entrega.</li>
        </ol>
      </section>

      {loja.entregas.length ? (
        <section className="mt-14 border-t border-linha pt-8">
          <h2 className="text-3xl">Entrega</h2>
          <ul className="mt-5 divide-y divide-linha">
            {loja.entregas.map((e) => (
              <li key={e.id} className="py-4">
                <p className="flex justify-between gap-4 font-medium">
                  {e.nome} <span className="tabular-nums">{valorEntrega(e)}</span>
                </p>
                {e.detalhe ? <p className="mt-1 text-sm text-suave">{e.detalhe}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-14 border-t border-linha pt-8">
        <h2 className="text-3xl">Contato</h2>
        <ul className="mt-5 space-y-2 text-[0.9375rem]">
          {loja.whatsapp ? (
            <li>
              WhatsApp:{" "}
              <a href={linkWhatsApp(loja.whatsapp)} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                {telefoneVisivel(loja.whatsapp)}
              </a>
            </li>
          ) : null}
          {loja.instagram ? (
            <li>
              Instagram:{" "}
              <a href={`https://instagram.com/${loja.instagram}`} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                @{loja.instagram}
              </a>
            </li>
          ) : null}
          {loja.email ? (
            <li>
              E-mail:{" "}
              <a href={`mailto:${loja.email}`} className="underline underline-offset-2">
                {loja.email}
              </a>
            </li>
          ) : null}
          {loja.endereco_loja || loja.cidade ? <li>Endereço: {[loja.endereco_loja, loja.cidade].filter(Boolean).join(", ")}</li> : null}
          {loja.horario ? <li>Horário: {loja.horario}</li> : null}
        </ul>
        <p className="mt-8 text-sm text-suave">
          Veja também a política de{" "}
          <Link href="/trocas" className="underline underline-offset-2">
            trocas e devoluções
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
