import { notFound, redirect } from "next/navigation";

/** Endereço curto usado nas notificações de relatório publicado. */
export default async function AtalhoRelatorio({ params }: PageProps<"/e/[empresaId]/relatorios/[relatorioId]">) {
  const { empresaId, relatorioId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(relatorioId)) notFound();
  redirect(`/e/${empresaId}/relatorios/publicados/${relatorioId}`);
}
