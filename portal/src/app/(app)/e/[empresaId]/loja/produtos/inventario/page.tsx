import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { Inventario } from "@/components/loja/produtos";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarProdutosLoja } from "@/lib/gestao/dados";

export const metadata: Metadata = { title: "Inventário" };

export default async function PaginaInventario({ params }: PageProps<"/e/[empresaId]/loja/produtos/inventario">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const produtos = await carregarProdutosLoja(ctx.supabase, empresaId, { ativos: true });
  return (
    <>
      <CabecalhoPagina
        titulo="Inventário"
        descricao="Conte o que tem no pátio e no depósito e digite as quantidades. O sistema ajusta a diferença e guarda o histórico."
        voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <Card>
        <CardContent className="pt-5">
          <Inventario empresaId={empresaId} produtos={produtos} />
        </CardContent>
      </Card>
    </>
  );
}
