import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Área de uma empresa: o acesso é conferido aqui, nas ações e no banco (RLS). */
export default async function LayoutEmpresa({ children, params }: LayoutProps<"/e/[empresaId]">) {
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  const ctx = await obterContextoEmpresa(empresaId);
  return (
    <>
      {ctx.acesso.demonstracao ? (
        <Alerta tom="alerta" className="mb-4" titulo="Empresa de demonstração">
          Os dados desta empresa são fictícios e servem apenas para apresentação do portal.
        </Alerta>
      ) : null}
      {!ctx.acesso.ativa ? (
        <Alerta tom="alerta" className="mb-4" titulo="Atendimento inativo">
          Esta empresa está marcada como inativa. As informações continuam disponíveis para consulta.
        </Alerta>
      ) : null}
      {children}
    </>
  );
}
