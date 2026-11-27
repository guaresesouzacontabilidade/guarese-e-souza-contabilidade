import type { Metadata } from "next";
import { ConteudoFluxo } from "@/components/relatorios/conteudo-fluxo";

export const metadata: Metadata = { title: "Fluxo de caixa" };

/** Fluxo de caixa dentro do Financeiro (o mesmo do menu Relatórios). */
export default async function FluxoFinanceiro({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/fluxo">) {
  const { empresaId } = await params;
  return <ConteudoFluxo empresaId={empresaId} sp={await searchParams} />;
}
