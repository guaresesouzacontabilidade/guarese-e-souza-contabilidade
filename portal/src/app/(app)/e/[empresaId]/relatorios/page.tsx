import type { Metadata } from "next";
import { ConteudoSaude } from "@/components/relatorios/conteudo-saude";

export const metadata: Metadata = { title: "Saúde financeira" };

export default async function SaudeFinanceira({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios">) {
  const { empresaId } = await params;
  return <ConteudoSaude empresaId={empresaId} sp={await searchParams} />;
}
