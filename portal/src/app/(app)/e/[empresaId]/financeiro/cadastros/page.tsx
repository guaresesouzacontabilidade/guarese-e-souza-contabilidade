import { redirect } from "next/navigation";
import { urlCom } from "@/components/ui/pagina";

/** Endereço antigo: os cadastros agora ficam em Financeiro → Configurações. */
export default async function Cadastros({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/cadastros">) {
  const { empresaId } = await params;
  redirect(urlCom(`/e/${empresaId}/financeiro/configuracoes`, await searchParams, {}));
}
