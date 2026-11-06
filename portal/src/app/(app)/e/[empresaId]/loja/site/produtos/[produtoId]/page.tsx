import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja, NavegacaoSite, SiteNaoLiberado } from "@/components/loja/navegacao-loja";
import { siteLiberado } from "@/lib/vitrine/liberacao";
import { FormProdutoSite, FotosProduto } from "@/components/loja/site";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { formatarMoeda } from "@/lib/dinheiro";
import { carregarCategoriasSite, carregarProdutosSite, carregarSite, miniatura, nomeCompletoCategoria } from "@/lib/vitrine/dados";

export const metadata: Metadata = { title: "Produto no site" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const slug = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "produto";

export default async function ProdutoNoSite({ params }: PageProps<"/e/[empresaId]/loja/site/produtos/[produtoId]">) {
  const { empresaId, produtoId } = await params;
  if (!UUID.test(produtoId)) notFound();
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!(await siteLiberado(empresaId))) return <SiteNaoLiberado empresaId={empresaId} equipe={ctx.equipe} />;
  if (!ctx.gerente) return <EstadoVazio titulo="Só quem gerencia a loja mexe nos produtos do site" />;
  const [produtos, categorias, site] = await Promise.all([
    carregarProdutosSite(ctx.supabase, empresaId),
    carregarCategoriasSite(ctx.supabase, empresaId),
    carregarSite(ctx.supabase, empresaId),
  ]);
  const p = produtos.find((x) => x.id === produtoId);
  if (!p) notFound();
  const nome = p.site?.nome ?? p.descricao;
  const opcoesCategoria = categorias
    .filter((c) => !c.pai_id)
    .flatMap((c) => [c, ...categorias.filter((s) => s.pai_id === c.id)])
    .map((c) => ({ id: c.id, nome: nomeCompletoCategoria(c, categorias) }));
  const naLoja = site?.endereco_site && p.site?.visivel ? `${site.endereco_site}/p/${p.id}/${slug(nome)}` : null;
  return (
    <>
      <CabecalhoPagina
        titulo={nome}
        descricao={`Código ${p.codigo}${p.site?.origem_externa ? ` · veio da ${p.site.origem_externa.split(":")[0] === "facilzap" ? "FácilZap" : p.site.origem_externa.split(":")[0]}` : ""}`}
        voltar={{ href: `/e/${empresaId}/loja/site/produtos`, rotulo: "Produtos no site" }}
        acoes={
          naLoja ? (
            <a href={naLoja} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              Ver no site
            </a>
          ) : null
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <NavegacaoSite empresaId={empresaId} gerente />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador rotulo="Preço (do cadastro)" valor={p.valor_unitario === null ? "sem preço" : formatarMoeda(p.valor_unitario)} href={`/e/${empresaId}/loja/produtos/${p.id}`} />
        <Indicador rotulo="Estoque" valor={p.controla_estoque ? p.estoque_atual.toLocaleString("pt-BR") : "não controla"} tom={p.controla_estoque && p.estoque_atual < 1 ? "perigo" : "neutro"} />
        <Indicador rotulo="No site" valor={!p.site ? "Fora" : p.site.visivel ? "Sim" : "Escondido"} tom={p.site?.visivel ? "sucesso" : "neutro"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_28rem]">
        <Card>
          <CardHeader>
            <CardTitle>Vitrine</CardTitle>
          </CardHeader>
          <CardContent>
            <FormProdutoSite
              empresaId={empresaId}
              categorias={opcoesCategoria}
              produto={{
                id: p.id,
                descricaoCadastro: p.descricao,
                visivel: p.site?.visivel ?? true,
                nome: p.site?.nome ?? "",
                descricao: p.site?.descricao ?? "",
                categoria_id: p.site?.categoria_id ?? null,
                rotulo_variacao: p.site?.rotulo_variacao ?? "Opção",
                variacoes: p.site?.variacoes ?? [],
                destaque: p.site?.destaque ?? false,
                preco_de: p.site?.preco_de ?? null,
              }}
            />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Fotos</CardTitle>
          </CardHeader>
          <CardContent>
            {/* A lista muda quando o portal atualiza as fotos: o componente recomeça com a lista nova */}
            <FotosProduto key={(p.site?.fotos ?? []).join("|")} empresaId={empresaId} produtoId={p.id} fotos={(p.site?.fotos ?? []).map((f) => ({ caminho: f, url: miniatura(f) }))} />
            <p className="mt-4 text-xs text-muted-foreground">
              Preço, estoque, NCM e código ficam em{" "}
              <Link href={`/e/${empresaId}/loja/produtos/${p.id}`} className="underline">
                Produtos e estoque
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
