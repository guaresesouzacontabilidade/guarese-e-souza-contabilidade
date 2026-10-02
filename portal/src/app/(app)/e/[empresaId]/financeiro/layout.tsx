import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { SubNavegacao } from "@/components/ui/subnav";

export default async function LayoutFinanceiro({ children, params }: LayoutProps<"/e/[empresaId]/financeiro">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) return <Alerta tom="alerta">Seu acesso não inclui o financeiro desta empresa.</Alerta>;
  const b = `/e/${empresaId}/financeiro`;
  const itens = [
    { rotulo: "Visão geral", href: b, exato: true },
    { rotulo: "Lançamentos", href: `${b}/lancamentos` },
    { rotulo: "Contas e saldos", href: `${b}/contas` },
    { rotulo: "Operações", href: `${b}/operacoes` },
    { rotulo: "Recorrências", href: `${b}/recorrencias` },
    ...(ctx.pode("financeiro.importar") ? [{ rotulo: "Importar extratos", href: `${b}/importar` }] : []),
    { rotulo: "Notas fiscais", href: `${b}/notas` },
    { rotulo: "Cadastros", href: `${b}/cadastros` },
  ];
  return (
    <>
      <SubNavegacao itens={itens} />
      {children}
    </>
  );
}
