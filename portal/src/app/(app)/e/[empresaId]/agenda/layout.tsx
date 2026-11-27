import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Agenda de pagamentos: some quando o escritório desliga a ferramenta para a empresa. */
export default async function LayoutAgenda({ children, params }: LayoutProps<"/e/[empresaId]/agenda">) {
  const { empresaId } = await params;
  return (
    <GuardaFerramenta empresaId={empresaId} ferramenta="agenda">
      {children}
    </GuardaFerramenta>
  );
}
