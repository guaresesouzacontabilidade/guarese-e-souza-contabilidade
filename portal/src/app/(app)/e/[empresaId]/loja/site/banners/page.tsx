import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { BannersSite } from "@/components/loja/banners";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite, SiteNaoLiberado } from "@/components/loja/navegacao-loja";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { siteLiberado } from "@/lib/vitrine/liberacao";
import { situacaoBanner } from "@/lib/vitrine/banners";
import { carregarBannersSite, carregarCategoriasSite, miniatura, nomeCompletoCategoria } from "@/lib/vitrine/dados";

export const metadata: Metadata = { title: "Banners do site" };

export default async function BannersDoSite({ params }: PageProps<"/e/[empresaId]/loja/site/banners">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!(await siteLiberado(empresaId))) return <SiteNaoLiberado empresaId={empresaId} equipe={ctx.equipe} />;
  if (!ctx.gerente) return <EstadoVazio titulo="Só quem gerencia a loja mexe nos banners do site" />;
  const [banners, categorias] = await Promise.all([carregarBannersSite(ctx.supabase, empresaId), carregarCategoriasSite(ctx.supabase, empresaId)]);
  return (
    <>
      <CabecalhoPagina
        titulo="Banners do site"
        descricao="Campanhas com data para entrar e sair do ar: Dia das Mães, Black Friday, Natal, lançamentos."
        voltar={{ href: `/e/${empresaId}/loja/site`, rotulo: "Site da loja" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <NavegacaoSite empresaId={empresaId} gerente />
      <Card>
        <CardContent className="pt-4">
          <BannersSite
            empresaId={empresaId}
            banners={banners.map((b) => ({
              ...b,
              computador: b.imagem_computador ? miniatura(b.imagem_computador) : null,
              celular: b.imagem_celular ? miniatura(b.imagem_celular) : null,
              situacao: situacaoBanner(b),
            }))}
            categorias={categorias
              .filter((c) => c.ativa)
              .map((c) => ({ nome: nomeCompletoCategoria(c, categorias), slug: c.slug }))
              .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))}
          />
        </CardContent>
      </Card>
    </>
  );
}
