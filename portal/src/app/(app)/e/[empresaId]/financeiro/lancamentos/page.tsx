import { redirect } from "next/navigation";
import { urlCom } from "@/components/ui/pagina";

/**
 * Endereço antigo: a lista de lançamentos agora é Contas a pagar e Contas a
 * receber (os filtros vão junto).
 */
export default async function Lancamentos({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/lancamentos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const tipo = sp.tipo === "receber" ? "receber" : "pagar";
  redirect(urlCom(`/e/${empresaId}/financeiro/${tipo}`, sp, { tipo: null }));
}
