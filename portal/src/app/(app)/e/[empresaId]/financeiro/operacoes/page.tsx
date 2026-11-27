import { redirect } from "next/navigation";

/** Endereço antigo: transferências e operações agora ficam em Financeiro → Caixa e bancos. */
export default async function Operacoes({ params }: PageProps<"/e/[empresaId]/financeiro/operacoes">) {
  const { empresaId } = await params;
  redirect(`/e/${empresaId}/financeiro/caixa#operacoes`);
}
