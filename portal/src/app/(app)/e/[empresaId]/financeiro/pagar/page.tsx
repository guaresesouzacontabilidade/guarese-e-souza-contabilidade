import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { PaginaTitulos } from "@/components/financeiro/pagina-titulos";

export const metadata: Metadata = { title: "Contas a pagar" };

export default async function ContasAPagar({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/pagar">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  return <PaginaTitulos ctx={ctx} empresaId={empresaId} tipo="pagar" sp={await searchParams} />;
}
