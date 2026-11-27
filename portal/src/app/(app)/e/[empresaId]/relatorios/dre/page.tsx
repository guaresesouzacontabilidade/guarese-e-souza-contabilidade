import type { Metadata } from "next";
import { ConteudoDre } from "@/components/relatorios/conteudo-dre";

export const metadata: Metadata = { title: "Resultado (DRE)" };

export default async function PaginaDre({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios/dre">) {
  const { empresaId } = await params;
  return <ConteudoDre empresaId={empresaId} sp={await searchParams} />;
}
