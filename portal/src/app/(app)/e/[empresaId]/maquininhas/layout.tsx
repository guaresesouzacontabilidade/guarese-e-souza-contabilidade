import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Maquininhas: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutMaquininhas({ children, params }: LayoutProps<"/e/[empresaId]/maquininhas">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="maquininhas">
      {children}
    </GuardaFerramenta>
  );
}
