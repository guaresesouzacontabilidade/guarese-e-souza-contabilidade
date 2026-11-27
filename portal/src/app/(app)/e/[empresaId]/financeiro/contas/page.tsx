import { redirect } from "next/navigation";

/** Endereço antigo: contas e saldos agora ficam em Financeiro → Caixa e bancos. */
export default async function Contas({ params }: PageProps<"/e/[empresaId]/financeiro/contas">) {
  const { empresaId } = await params;
  redirect(`/e/${empresaId}/financeiro/caixa`);
}
