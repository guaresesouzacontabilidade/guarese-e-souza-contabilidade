import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Ordens de serviço: só aparecem quando o escritório liga a ferramenta na empresa. */
export default async function LayoutOs({ children, params }: LayoutProps<"/e/[empresaId]/os">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="os">
      {children}
    </GuardaFerramenta>
  );
}
