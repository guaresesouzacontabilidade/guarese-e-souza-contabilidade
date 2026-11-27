import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { PaginaTitulos } from "@/components/financeiro/pagina-titulos";

export const metadata: Metadata = { title: "Contas a receber" };

export default async function ContasAReceber({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/receber">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  return <PaginaTitulos ctx={ctx} empresaId={empresaId} tipo="receber" sp={await searchParams} />;
}
