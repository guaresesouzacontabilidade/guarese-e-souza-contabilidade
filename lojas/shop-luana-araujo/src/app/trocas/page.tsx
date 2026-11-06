import type { Metadata } from "next";
import { linkWhatsApp } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";

export const metadata: Metadata = { title: "Trocas e devoluções" };
export const revalidate = 60;

/** Sem texto próprio cadastrado no portal, vale o resumo dos direitos do Código de Defesa do Consumidor. */
const PADRAO = `Compras feitas pelo site ou pelo WhatsApp podem ser desistidas em até 7 dias depois do recebimento (direito de arrependimento, art. 49 do Código de Defesa do Consumidor). Nesse caso, o valor pago é devolvido.

Produto com defeito pode ser reclamado em até 30 dias (produtos não duráveis, como maquiagem) ou em até 90 dias (produtos duráveis, como joias e acessórios), contados do recebimento (art. 26 do Código de Defesa do Consumidor).

Para pedir a troca ou a devolução, fale com a loja pelo WhatsApp informando o número do pedido.`;

export default async function Trocas() {
  const { loja } = await obterVitrine();
  return (
    <article className="conteudo max-w-3xl pt-10 md:pt-16">
      <p className="sobretitulo">Informações</p>
      <h1 className="mt-3 text-4xl md:text-5xl">Trocas e devoluções</h1>
      <p className="texto-corrido mt-6">{loja.politica_trocas ?? PADRAO}</p>
      {loja.whatsapp ? (
        <a href={linkWhatsApp(loja.whatsapp, "Olá! Quero falar sobre uma troca ou devolução. Pedido nº ")} className="botao-contorno mt-10" target="_blank" rel="noopener noreferrer">
          Falar com a loja
        </a>
      ) : null}
    </article>
  );
}
