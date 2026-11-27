import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Notas automáticas: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutNotasAutomaticas({ children, params }: LayoutProps<"/e/[empresaId]/notas-automaticas">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="notas_automaticas">
      {children}
    </GuardaFerramenta>
  );
}
