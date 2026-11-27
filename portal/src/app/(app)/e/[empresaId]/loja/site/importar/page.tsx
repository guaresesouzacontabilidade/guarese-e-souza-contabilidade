import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite, SiteNaoLiberado } from "@/components/loja/navegacao-loja";
import { ImportarFacilZap } from "@/components/loja/importar-facilzap";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { siteLiberado } from "@/lib/vitrine/liberacao";
import { carregarSite } from "@/lib/vitrine/dados";

export const metadata: Metadata = { title: "Importar da FácilZap" };

export default async function ImportarDaFacilZap({ params }: PageProps<"/e/[empresaId]/loja/site/importar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!(await siteLiberado(empresaId))) return <SiteNaoLiberado empresaId={empresaId} equipe={ctx.equipe} />;
  if (!ctx.gerente) return <EstadoVazio titulo="Só quem gerencia a loja importa produtos" />;
  const site = await carregarSite(ctx.supabase, empresaId);
  return (
    <>
      <CabecalhoPagina
        titulo="Importar da FácilZap"
        descricao="Para trocar a FácilZap pelo site ligado ao portal sem cadastrar tudo de novo. Pode rodar quantas vezes quiser até a troca: não duplica produtos."
        voltar={{ href: `/e/${empresaId}/loja/site`, rotulo: "Site da loja" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <NavegacaoSite empresaId={empresaId} gerente />
      <Card>
        <CardContent className="pt-4">
          <ImportarFacilZap empresaId={empresaId} enderecoInicial={site?.endereco_site ?? ""} />
        </CardContent>
      </Card>
    </>
  );
}
