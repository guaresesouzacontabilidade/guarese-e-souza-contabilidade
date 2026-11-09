import type { Metadata } from "next";
import { cnpjVisivel } from "@/lib/catalogo";
import { obterVitrine } from "@/lib/portal";

export const metadata: Metadata = { title: "Privacidade" };
export const revalidate = 60;

export default async function Privacidade() {
  const { loja } = await obterVitrine();
  const responsavel = [loja.razao_social ?? loja.nome, loja.cnpj ? `CNPJ ${cnpjVisivel(loja.cnpj)}` : null].filter(Boolean).join(", ");
  return (
    <article className="conteudo max-w-3xl pt-10 md:pt-16">
      <p className="sobretitulo">Informações</p>
      <h1 className="mt-3 text-4xl md:text-5xl">Política de privacidade</h1>
      <div className="mt-8 space-y-8 text-[0.9375rem] leading-relaxed">
        <section>
          <h2 className="text-2xl">Quem cuida dos seus dados</h2>
          <p className="mt-2">{responsavel} é a responsável pelos dados informados neste site (Lei Geral de Proteção de Dados, Lei 13.709/2018).</p>
        </section>
        <section>
          <h2 className="text-2xl">O que guardamos e para quê</h2>
          <p className="mt-2">
            Ao enviar um pedido, você informa nome, WhatsApp e, quando há entrega, o endereço. Esses dados servem só para atender o pedido: confirmar os produtos,
            combinar o pagamento, entregar e emitir a nota fiscal. Eles ficam no sistema de gestão da loja (Portal Guarese&apos;s ON), com acesso restrito a quem atende a loja.
          </p>
          <p className="mt-2">Não vendemos nem repassamos seus dados. Não usamos cookies de propaganda nem ferramentas de rastreamento.</p>
        </section>
        <section>
          <h2 className="text-2xl">Sacola</h2>
          <p className="mt-2">Os produtos que você coloca na sacola ficam guardados só no seu aparelho, no próprio navegador, até você enviar o pedido ou tirá-los.</p>
        </section>
        <section>
          <h2 className="text-2xl">Seus direitos</h2>
          <p className="mt-2">
            Você pode pedir para ver, corrigir ou apagar seus dados a qualquer momento
            {loja.email ? (
              <>
                {" "}
                pelo e-mail <a href={`mailto:${loja.email}`} className="underline underline-offset-2">{loja.email}</a>
              </>
            ) : null}
            {loja.whatsapp ? " ou pelo WhatsApp da loja" : ""}. Dados ligados a vendas e notas fiscais são mantidos pelo prazo exigido pela lei.
          </p>
        </section>
      </div>
    </article>
  );
}
