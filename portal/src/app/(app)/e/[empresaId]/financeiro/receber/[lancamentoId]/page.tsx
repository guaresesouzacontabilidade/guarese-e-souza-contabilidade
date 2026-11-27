import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { PaginaTitulo } from "@/components/financeiro/pagina-titulo";

export const metadata: Metadata = { title: "Conta a receber" };

export default async function Titulo({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/receber/[lancamentoId]">) {
  const { empresaId, lancamentoId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  return <PaginaTitulo ctx={ctx} empresaId={empresaId} lancamentoId={lancamentoId} tipoRota="receber" sp={await searchParams} />;
}
