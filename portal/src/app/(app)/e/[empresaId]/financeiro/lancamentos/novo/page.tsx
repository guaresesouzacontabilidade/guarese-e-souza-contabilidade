import { redirect } from "next/navigation";
import { urlCom } from "@/components/ui/pagina";

/** Endereço antigo: nova despesa em Contas a pagar, nova receita em Contas a receber. */
export default async function NovoLancamento({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/lancamentos/novo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const tipo = sp.tipo === "receber" ? "receber" : "pagar";
  redirect(urlCom(`/e/${empresaId}/financeiro/${tipo}/novo`, sp, { tipo: null }));
}
