import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { SubNavegacao } from "@/components/ui/subnav";

/** Área de cálculos: previsão de impostos, rescisão, colaboradores e (equipe) comparativo de regimes e configuração. */
export default async function LayoutCalculos({ children, params }: LayoutProps<"/e/[empresaId]/calculos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.ver")) return <Alerta tom="alerta">Seu acesso não inclui os cálculos desta empresa.</Alerta>;
  const b = `/e/${empresaId}/calculos`;
  const itens = [
    { rotulo: "Previsão de impostos", href: b, exato: true },
    { rotulo: "Simulação de rescisão", href: `${b}/rescisao` },
    { rotulo: "Colaboradores", href: `${b}/colaboradores` },
    ...(ctx.pode("calculos.gerenciar")
      ? [
          { rotulo: "Comparativo de regimes", href: `${b}/comparativo` },
          { rotulo: "Configuração", href: `${b}/configuracao` },
        ]
      : []),
  ];
  return (
    <>
      <SubNavegacao itens={itens} />
      {children}
    </>
  );
}
