import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Notas de produto: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutNotasProduto({ children, params }: LayoutProps<"/e/[empresaId]/notas-produto">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="nfe">
      {children}
    </GuardaFerramenta>
  );
}
