import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Vencimentos: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutVencimentos({ children, params }: LayoutProps<"/e/[empresaId]/vencimentos">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="vencimentos">
      {children}
    </GuardaFerramenta>
  );
}
