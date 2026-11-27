import type { Metadata, Viewport } from "next";
import { arvoreCategorias, linkWhatsApp } from "@/lib/catalogo";
import { emDemonstracao, obterVitrine } from "@/lib/portal";
import { descricaoLoja } from "@/lib/textos";
import { Cabecalho } from "@/components/cabecalho";
import { Rodape } from "@/components/rodape";
import { AvisoSacola, WhatsAppFlutuante } from "@/components/avisos";
import { IconeWhatsApp } from "@/components/icones";
import { TransicaoDeTela } from "@/components/transicao-de-tela";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { loja, categorias, produtos } = await obterVitrine();
  const descricao = descricaoLoja(loja, arvoreCategorias(categorias, produtos));
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? loja.endereco_site ?? "http://localhost:3100"),
    title: { default: loja.nome, template: `%s · ${loja.nome}` },
    description: descricao,
    applicationName: loja.nome,
    openGraph: { type: "website", locale: "pt_BR", siteName: loja.nome, title: loja.nome, description: descricao },
    twitter: { card: "summary_large_image" },
    formatDetection: { telephone: false },
    robots: emDemonstracao() ? { index: false, follow: false } : undefined,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1c1917",
};

export default async function Layout({ children }: LayoutProps<"/">) {
  const { aberta, loja, categorias, produtos } = await obterVitrine();
  const arvore = arvoreCategorias(categorias ?? [], produtos ?? []);
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col">
        <a href="#conteudo" className="sr-only z-[60] bg-tinta px-4 py-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Pular para o conteúdo
        </a>
        {emDemonstracao() ? (
          <div className="bg-alerta px-4 py-1.5 text-center text-xs font-medium text-white">Demonstração com produtos de exemplo — pedidos não são registrados</div>
        ) : null}
        <Cabecalho loja={loja} arvore={arvore} />
        <main id="conteudo" className="flex-1">
          {aberta ? (
            children
          ) : (
            <section className="conteudo flex flex-col items-center py-28 text-center">
              <p className="sobretitulo">{loja.nome}</p>
              <h1 className="mt-4 text-4xl md:text-5xl">A loja online está fechada no momento</h1>
              <p className="mt-4 max-w-md text-suave">Enquanto isso, fale com a gente pelo WhatsApp ou pelo Instagram.</p>
              {loja.whatsapp ? (
                <a href={linkWhatsApp(loja.whatsapp)} className="botao mt-8" target="_blank" rel="noopener noreferrer">
                  <IconeWhatsApp className="size-4" /> Falar no WhatsApp
                </a>
              ) : null}
            </section>
          )}
        </main>
        <Rodape loja={loja} />
        <TransicaoDeTela />
        <AvisoSacola />
        {loja.whatsapp ? <WhatsAppFlutuante numero={loja.whatsapp} /> : null}
      </body>
    </html>
  );
}
