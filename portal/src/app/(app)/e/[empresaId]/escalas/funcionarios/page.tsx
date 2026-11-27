import { redirect } from "next/navigation";

/** O cadastro dos funcionários mudou para a Gestão de RH (o endereço antigo continua valendo). */
export default async function PaginaFuncionariosEscala({ params }: PageProps<"/e/[empresaId]/escalas/funcionarios">) {
  const { empresaId } = await params;
  redirect(`/e/${empresaId}/rh/funcionarios`);
}
