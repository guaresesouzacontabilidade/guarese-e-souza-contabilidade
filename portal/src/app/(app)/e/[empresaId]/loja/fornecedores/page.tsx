import type { Metadata } from "next";
import { ListaCadastrosLoja } from "@/components/loja/pagina-cadastros";

export const metadata: Metadata = { title: "Fornecedores" };

export default async function PaginaFornecedores({ params, searchParams }: PageProps<"/e/[empresaId]/loja/fornecedores">) {
  const { empresaId } = await params;
  return <ListaCadastrosLoja empresaId={empresaId} papel="fornecedor" sp={await searchParams} />;
}
