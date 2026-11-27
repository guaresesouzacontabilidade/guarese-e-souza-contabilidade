import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Solicitações: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutSolicitacoes({ children, params }: LayoutProps<"/e/[empresaId]/solicitacoes">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="solicitacoes">
      {children}
    </GuardaFerramenta>
  );
}
