import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { SubNavegacao } from "@/components/ui/subnav";

export default async function LayoutRelatorios({ children, params }: LayoutProps<"/e/[empresaId]/relatorios">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const verFinanceiro = ctx.pode("financeiro.ver");
  const verRelatorios = ctx.pode("relatorios.ver") || ctx.pode("relatorios.publicar");
  if (!verFinanceiro && !verRelatorios) return <Alerta tom="alerta">Seu acesso não inclui os relatórios desta empresa.</Alerta>;
  const b = `/e/${empresaId}/relatorios`;
  const itens = [
    ...(verFinanceiro
      ? [
          { rotulo: "Saúde financeira", href: b, exato: true },
          { rotulo: "Resultado (DRE)", href: `${b}/dre` },
          { rotulo: "Fluxo de caixa", href: `${b}/fluxo` },
        ]
      : []),
    ...(verRelatorios ? [{ rotulo: "Relatórios do escritório", href: `${b}/publicados` }] : []),
  ];
  return (
    <>
      <SubNavegacao itens={itens} />
      {children}
    </>
  );
}
