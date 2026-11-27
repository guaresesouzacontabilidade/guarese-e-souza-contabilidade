import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { SubNavegacao } from "@/components/ui/subnav";
import { GuardaFerramenta } from "@/components/empresas/guarda-ferramenta";

/** Área de cálculos: previsão de impostos, rescisão, colaboradores e (equipe) apuração do ICMS, EFD ICMS/IPI, comparativo de regimes e configuração. */
export default async function LayoutCalculos({ children, params }: LayoutProps<"/e/[empresaId]/calculos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  // Ferramenta desligada pelo escritório: o aviso no lugar da tela
  if (ctx.acesso.ferramentas_desligadas.includes("calculos")) return <GuardaFerramenta empresaId={empresaId} ferramenta="calculos">{children}</GuardaFerramenta>;
  if (!ctx.pode("calculos.ver")) return <Alerta tom="alerta">Seu acesso não inclui os cálculos desta empresa.</Alerta>;
  const b = `/e/${empresaId}/calculos`;
  const itens = [
    { rotulo: "Previsão de impostos", href: b, exato: true },
    { rotulo: "Simulação de rescisão", href: `${b}/rescisao` },
    { rotulo: "Colaboradores", href: `${b}/colaboradores` },
    ...(ctx.pode("calculos.gerenciar")
      ? [
          { rotulo: "Apuração do ICMS", href: `${b}/icms` },
          { rotulo: "EFD ICMS/IPI", href: `${b}/efd` },
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
