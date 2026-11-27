import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite, SiteNaoLiberado } from "@/components/loja/navegacao-loja";
import { ChaveSite, FormSite } from "@/components/loja/site";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { siteLiberado } from "@/lib/vitrine/liberacao";
import { carregarSite } from "@/lib/vitrine/dados";
import { envPublico } from "@/lib/env";

export const metadata: Metadata = { title: "Configurar o site" };

function sugestaoSlug(nome: string) {
  return (
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "minha-loja"
  );
}

export default async function ConfigurarSite({ params }: PageProps<"/e/[empresaId]/loja/site/configurar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!(await siteLiberado(empresaId))) return <SiteNaoLiberado empresaId={empresaId} equipe={ctx.equipe} />;
  if (!ctx.gerente) {
    return <EstadoVazio titulo="Só quem gerencia a loja configura o site" descricao="Peça a permissão “Gerenciar a loja” ao responsável pela empresa." />;
  }
  const site = await carregarSite(ctx.supabase, empresaId);
  const nome = ctx.acesso.nome_fantasia ?? ctx.acesso.razao_social;
  return (
    <>
      <CabecalhoPagina titulo="Configurar o site" descricao="Dados que aparecem no site da loja, formas de entrega e a chave que liga o site ao portal." voltar={{ href: `/e/${empresaId}/loja/site`, rotulo: "Site da loja" }} />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <NavegacaoSite empresaId={empresaId} gerente />
      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>Dados do site</CardTitle>
          </CardHeader>
          <CardContent>
            <FormSite
              empresaId={empresaId}
              site={
                site
                  ? { ...site, pedido_minimo: site.pedido_minimo === null ? null : Number(site.pedido_minimo), pagamentos: site.pagamentos ?? [] }
                  : {
                      ativo: false,
                      slug: sugestaoSlug(nome),
                      nome,
                      endereco_site: null,
                      whatsapp: null,
                      instagram: null,
                      email: null,
                      endereco_loja: null,
                      cidade: null,
                      horario: null,
                      aviso: null,
                      sobre: null,
                      politica_trocas: null,
                      pedido_minimo: null,
                      pagamentos: ["pix", "cartao_credito", "cartao_debito", "dinheiro"],
                      entregas: [],
                    }
              }
            />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Ligação com o site</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {site ? (
              <ChaveSite empresaId={empresaId} inicio={site.chave_inicio} geradaEm={site.chave_gerada_em} slug={site.slug} portalUrl={envPublico.siteUrl()} />
            ) : (
              <p className="text-muted-foreground">Salve os dados do site para gerar a chave.</p>
            )}
            <p className="text-xs text-muted-foreground">
              O site não tem banco próprio: lê os produtos e o estoque daqui (no máximo uma vez por minuto) e manda os pedidos para cá. Só quem tem a chave consegue ler o catálogo ou criar pedidos.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
