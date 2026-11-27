import type { Metadata } from "next";
import { ConteudoSaude } from "@/components/relatorios/conteudo-saude";

export const metadata: Metadata = { title: "Saúde financeira" };

/** Saúde financeira dentro do Financeiro. */
export default async function SaudeFinanceiro({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/relatorios/saude">) {
  const { empresaId } = await params;
  return <ConteudoSaude empresaId={empresaId} sp={await searchParams} />;
}
