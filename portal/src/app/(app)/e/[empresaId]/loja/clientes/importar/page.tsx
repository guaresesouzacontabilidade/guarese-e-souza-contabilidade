import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { ImportarCadastros } from "@/components/loja/importar-cadastros";
import { obterContextoLoja } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Importar clientes" };

export default async function PaginaImportarClientes({ params }: PageProps<"/e/[empresaId]/loja/clientes/importar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.gerente) notFound();
  return (
    <>
      <CabecalhoPagina
        titulo="Importar clientes"
        descricao="Traga a lista de clientes de outro sistema (GestãoClick e outros) por planilha, sem digitar um por um."
        voltar={{ href: `/e/${empresaId}/loja/clientes`, rotulo: "Clientes" }}
      />
      <ImportarCadastros empresaId={empresaId} papel="cliente" />
    </>
  );
}
