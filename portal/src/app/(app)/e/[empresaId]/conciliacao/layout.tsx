import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Conciliação: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutConciliacao({ children, params }: LayoutProps<"/e/[empresaId]/conciliacao">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="conciliacao">
      {children}
    </GuardaFerramenta>
  );
}
