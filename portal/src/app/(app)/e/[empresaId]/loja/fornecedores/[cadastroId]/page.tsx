import type { Metadata } from "next";
import { FichaCadastroLoja } from "@/components/loja/pagina-cadastros";

export const metadata: Metadata = { title: "Ficha do fornecedor" };

export default async function PaginaFichaFornecedor({ params }: PageProps<"/e/[empresaId]/loja/fornecedores/[cadastroId]">) {
  const { empresaId, cadastroId } = await params;
  return <FichaCadastroLoja empresaId={empresaId} papel="fornecedor" id={cadastroId} />;
}
