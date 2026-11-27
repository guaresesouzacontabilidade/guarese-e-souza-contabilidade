import { notFound, redirect } from "next/navigation";
import { obterContextoRh } from "@/lib/rh/dados";

/** Gestão de RH: abre nas tarefas (ou no cadastro, para quem só cuida dos funcionários). */
export default async function PaginaRh({
  params,
}: PageProps<"/e/[empresaId]/rh">) {
  const { empresaId } = await params;
  const ctx = await obterContextoRh(empresaId);
  if (ctx.gestor || ctx.fazTarefas) redirect(`/e/${empresaId}/rh/tarefas`);
  if (ctx.cadastro) redirect(`/e/${empresaId}/rh/funcionarios`);
  if (ctx.escalas) redirect(`/e/${empresaId}/escalas`);
  notFound();
}
