import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Declarações: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutDeclaracoes({ children, params }: LayoutProps<"/e/[empresaId]/declaracoes">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="declaracoes">
      {children}
    </GuardaFerramenta>
  );
}
