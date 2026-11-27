import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Notas de serviço: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutNotasServico({ children, params }: LayoutProps<"/e/[empresaId]/notas-servico">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="nfse">
      {children}
    </GuardaFerramenta>
  );
}
