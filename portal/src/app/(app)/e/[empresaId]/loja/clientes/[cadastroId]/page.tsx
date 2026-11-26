import type { Metadata } from "next";
import { FichaCadastroLoja } from "@/components/loja/pagina-cadastros";

export const metadata: Metadata = { title: "Ficha do cliente" };

export default async function PaginaFichaCliente({ params }: PageProps<"/e/[empresaId]/loja/clientes/[cadastroId]">) {
  const { empresaId, cadastroId } = await params;
  return <FichaCadastroLoja empresaId={empresaId} papel="cliente" id={cadastroId} />;
}
