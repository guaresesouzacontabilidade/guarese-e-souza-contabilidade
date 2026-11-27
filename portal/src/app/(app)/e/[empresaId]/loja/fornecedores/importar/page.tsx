import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { ImportarCadastros } from "@/components/loja/importar-cadastros";
import { obterContextoLoja } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Importar fornecedores" };

export default async function PaginaImportarFornecedores({ params }: PageProps<"/e/[empresaId]/loja/fornecedores/importar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.gerente) notFound();
  return (
    <>
      <CabecalhoPagina
        titulo="Importar fornecedores"
        descricao="Traga a lista de fornecedores de outro sistema (GestãoClick e outros) por planilha, sem digitar um por um."
        voltar={{ href: `/e/${empresaId}/loja/fornecedores`, rotulo: "Fornecedores" }}
      />
      <ImportarCadastros empresaId={empresaId} papel="fornecedor" />
    </>
  );
}
