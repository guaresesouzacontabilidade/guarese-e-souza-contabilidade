import type { Metadata } from "next";
import { ConteudoDre } from "@/components/relatorios/conteudo-dre";

export const metadata: Metadata = { title: "Resultado (DRE)" };

/** Resultado (DRE gerencial, por competência) dentro do Financeiro. */
export default async function DreFinanceiro({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/relatorios/dre">) {
  const { empresaId } = await params;
  return <ConteudoDre empresaId={empresaId} sp={await searchParams} base={`/e/${empresaId}/financeiro/relatorios/dre`} />;
}
