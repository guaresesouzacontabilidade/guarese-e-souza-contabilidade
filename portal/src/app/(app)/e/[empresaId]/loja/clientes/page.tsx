import type { Metadata } from "next";
import { ListaCadastrosLoja } from "@/components/loja/pagina-cadastros";

export const metadata: Metadata = { title: "Clientes" };

export default async function PaginaClientes({ params, searchParams }: PageProps<"/e/[empresaId]/loja/clientes">) {
  const { empresaId } = await params;
  return <ListaCadastrosLoja empresaId={empresaId} papel="cliente" sp={await searchParams} />;
}
