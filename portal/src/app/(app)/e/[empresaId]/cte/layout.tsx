import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** CT-e: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutCte({ children, params }: LayoutProps<"/e/[empresaId]/cte">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="cte">
      {children}
    </GuardaFerramenta>
  );
}
