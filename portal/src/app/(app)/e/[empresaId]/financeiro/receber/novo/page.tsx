import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { PaginaNovoTitulo } from "@/components/financeiro/pagina-novo-titulo";

export const metadata: Metadata = { title: "Nova receita" };

export default async function NovaReceita({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/receber/novo">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  return <PaginaNovoTitulo ctx={ctx} empresaId={empresaId} sp={await searchParams} tipo="receber" />;
}
