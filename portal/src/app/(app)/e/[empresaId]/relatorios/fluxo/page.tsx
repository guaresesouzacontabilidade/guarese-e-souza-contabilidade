import type { Metadata } from "next";
import { ConteudoFluxo } from "@/components/relatorios/conteudo-fluxo";

export const metadata: Metadata = { title: "Fluxo de caixa" };

export default async function FluxoCaixa({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios/fluxo">) {
  const { empresaId } = await params;
  return <ConteudoFluxo empresaId={empresaId} sp={await searchParams} />;
}
