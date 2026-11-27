import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Auditor fiscal: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutAuditorFiscal({ children, params }: LayoutProps<"/e/[empresaId]/auditor-fiscal">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="auditor">
      {children}
    </GuardaFerramenta>
  );
}
