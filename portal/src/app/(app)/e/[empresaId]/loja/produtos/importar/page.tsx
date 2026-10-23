import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { ImportarProdutos } from "@/components/loja/importar-produtos";
import { obterContextoLoja } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Importar produtos" };

export default async function PaginaImportarProdutos({ params }: PageProps<"/e/[empresaId]/loja/produtos/importar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  return (
    <>
      <CabecalhoPagina
        titulo="Importar produtos e estoque"
        descricao="Cadastre muitos produtos de uma vez, ou mude preços e estoque em lote, com uma planilha do Excel."
        voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <ImportarProdutos empresaId={empresaId} />
    </>
  );
}
