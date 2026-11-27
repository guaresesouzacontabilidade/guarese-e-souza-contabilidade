import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";
import { BotaoLancarCelular } from "@/components/financeiro/botao-lancar-celular";

/**
 * Financeiro: as abas (Visão geral, Contas a pagar, Contas a receber, Caixa e
 * bancos, Conciliação, Fluxo de caixa, Relatórios, Configurações) vêm do menu
 * da empresa, numa fileira só no topo.
 */
export default async function LayoutFinanceiro({ children, params }: LayoutProps<"/e/[empresaId]/financeiro">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  // Ferramenta desligada pelo escritório: o aviso no lugar da tela
  if (ctx.acesso.ferramentas_desligadas.includes("financeiro")) return <GuardaFerramenta empresaId={empresaId} ferramenta="financeiro">{children}</GuardaFerramenta>;
  if (!ctx.pode("financeiro.ver")) return <Alerta tom="alerta">Seu acesso não inclui o financeiro desta empresa.</Alerta>;
  return (
    <>
      {children}
      {ctx.pode("financeiro.editar") ? <BotaoLancarCelular base={`/e/${empresaId}/financeiro`} /> : null}
    </>
  );
}
