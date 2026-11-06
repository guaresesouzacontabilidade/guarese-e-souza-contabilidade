import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite, SiteNaoLiberado } from "@/components/loja/navegacao-loja";
import { CategoriasSite } from "@/components/loja/site";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { siteLiberado } from "@/lib/vitrine/liberacao";
import { buscarTudo } from "@/lib/supabase/paginar";
import { carregarCategoriasSite } from "@/lib/vitrine/dados";

export const metadata: Metadata = { title: "Categorias do site" };

export default async function CategoriasDoSite({ params }: PageProps<"/e/[empresaId]/loja/site/categorias">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!(await siteLiberado(empresaId))) return <SiteNaoLiberado empresaId={empresaId} equipe={ctx.equipe} />;
  if (!ctx.gerente) return <EstadoVazio titulo="Só quem gerencia a loja mexe nas categorias do site" />;
  const [categorias, produtos] = await Promise.all([
    carregarCategoriasSite(ctx.supabase, empresaId),
    buscarTudo((de, ate) => ctx.supabase.from("loja_site_produtos").select("categoria_id").eq("empresa_id", empresaId).range(de, ate)),
  ]);
  const porCategoria = new Map<string, number>();
  for (const p of produtos) if (p.categoria_id) porCategoria.set(p.categoria_id, (porCategoria.get(p.categoria_id) ?? 0) + 1);
  return (
    <>
      <CabecalhoPagina titulo="Categorias do site" descricao="Dois níveis: categoria principal (ex.: Maquiagens) e as de dentro (ex.: Bases). No menu do site, as numeradas (1, 2, 3…) vêm primeiro; as com ordem 0 seguem das com mais produtos para as com menos." voltar={{ href: `/e/${empresaId}/loja/site`, rotulo: "Site da loja" }} />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <NavegacaoSite empresaId={empresaId} gerente />
      <Card>
        <CardContent className="pt-4">
          <CategoriasSite empresaId={empresaId} categorias={categorias.map((c) => ({ id: c.id, pai_id: c.pai_id, nome: c.nome, ordem: c.ordem, ativa: c.ativa, produtos: porCategoria.get(c.id) ?? 0 }))} />
        </CardContent>
      </Card>
    </>
  );
}
