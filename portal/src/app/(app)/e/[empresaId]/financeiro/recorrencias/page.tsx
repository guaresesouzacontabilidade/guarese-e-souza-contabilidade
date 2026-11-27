import { redirect } from "next/navigation";

/** Endereço antigo: as recorrências agora ficam em Financeiro → Configurações. */
export default async function Recorrencias({ params }: PageProps<"/e/[empresaId]/financeiro/recorrencias">) {
  const { empresaId } = await params;
  redirect(`/e/${empresaId}/financeiro/configuracoes?aba=recorrencias`);
}
