import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { PaginaTitulo } from "@/components/financeiro/pagina-titulo";

export const metadata: Metadata = { title: "Lançamento" };

/** Endereço antigo do lançamento: vai para Contas a pagar ou a receber, conforme o tipo. */
export default async function Lancamento({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/lancamentos/[lancamentoId]">) {
  const { empresaId, lancamentoId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  return <PaginaTitulo ctx={ctx} empresaId={empresaId} lancamentoId={lancamentoId} tipoRota={null} sp={await searchParams} />;
}
