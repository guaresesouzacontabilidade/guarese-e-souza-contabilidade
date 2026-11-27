import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { PaginaContraparte } from "@/components/financeiro/pagina-contraparte";

export const metadata: Metadata = { title: "Histórico do fornecedor" };

export default async function HistoricoContraparte({ params }: PageProps<"/e/[empresaId]/financeiro/pagar/contraparte/[contraparteId]">) {
  const { empresaId, contraparteId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  return <PaginaContraparte ctx={ctx} empresaId={empresaId} contraparteId={contraparteId} tipo="pagar" />;
}
