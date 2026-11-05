import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite } from "@/components/loja/navegacao-loja";
import { ListaProdutosSite, type ProdutoListaSite } from "@/components/loja/site";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarCategoriasSite, carregarProdutosSite, miniatura, nomeCompletoCategoria } from "@/lib/vitrine/dados";

export const metadata: Metadata = { title: "Produtos no site" };

export default async function ProdutosNoSite({ params }: PageProps<"/e/[empresaId]/loja/site/produtos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!ctx.gerente) return <EstadoVazio titulo="Só quem gerencia a loja mexe nos produtos do site" />;
  const [produtos, categorias] = await Promise.all([carregarProdutosSite(ctx.supabase, empresaId), carregarCategoriasSite(ctx.supabase, empresaId)]);
  const lista: ProdutoListaSite[] = produtos.map((p) => {
    const cat = p.site?.categoria_id ? categorias.find((c) => c.id === p.site?.categoria_id) : null;
    return {
      id: p.id,
      codigo: p.codigo,
      nome: p.site?.nome ?? p.descricao,
      preco: p.valor_unitario,
      estoque: p.controla_estoque ? p.estoque_atual : null,
      categoria: cat ? nomeCompletoCategoria(cat, categorias) : null,
      situacao: !p.site ? "fora" : p.site.visivel ? "no_site" : "escondido",
      fotos: p.site?.fotos.length ?? 0,
      miniatura: p.site?.fotos[0] ? miniatura(p.site.fotos[0]) : null,
      destaque: p.site?.destaque ?? false,
    };
  });
  return (
    <>
      <CabecalhoPagina
        titulo="Produtos no site"
        descricao="Os produtos são os mesmos da loja: preço e estoque vêm do cadastro. Aqui ficam o nome de vitrine, as fotos, a descrição, as opções (cor, tom, tamanho) e a categoria."
        voltar={{ href: `/e/${empresaId}/loja/site`, rotulo: "Site da loja" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <NavegacaoSite empresaId={empresaId} gerente />
      <Card>
        <CardContent className="pt-4">
          {lista.length ? <ListaProdutosSite empresaId={empresaId} produtos={lista} /> : <p className="py-6 text-center text-sm text-muted-foreground">Cadastre produtos em “Produtos e estoque” ou importe da FácilZap.</p>}
        </CardContent>
      </Card>
    </>
  );
}
