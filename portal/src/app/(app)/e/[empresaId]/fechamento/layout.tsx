import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Fechamento: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutFechamento({ children, params }: LayoutProps<"/e/[empresaId]/fechamento">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="fechamento">
      {children}
    </GuardaFerramenta>
  );
}
