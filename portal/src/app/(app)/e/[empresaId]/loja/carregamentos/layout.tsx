import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Ordens de carregamento (dependem da NF-e): some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutCarregamentos({ children, params }: LayoutProps<"/e/[empresaId]/loja/carregamentos">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="nfe">
      {children}
    </GuardaFerramenta>
  );
}
