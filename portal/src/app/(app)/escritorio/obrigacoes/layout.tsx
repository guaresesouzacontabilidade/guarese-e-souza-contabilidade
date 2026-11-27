import { exigirEquipe } from "@/lib/auth/sessao";
import { SubNavegacao } from "@/components/ui/subnav";

const BASE = "/escritorio/obrigacoes";

/** Camada operacional interna: somente a equipe do escritório acessa. */
export default async function LayoutObrigacoes({ children }: LayoutProps<"/escritorio/obrigacoes">) {
  await exigirEquipe();
  return (
    <>
      <SubNavegacao
        itens={[
          { rotulo: "Painel", href: BASE, exato: true },
          { rotulo: "Tarefas", href: `${BASE}/tarefas` },
          { rotulo: "Agenda", href: `${BASE}/agenda` },
          { rotulo: "Empresas", href: `${BASE}/empresas` },
          { rotulo: "Catálogo", href: `${BASE}/catalogo` },
          { rotulo: "Atualizações normativas", href: `${BASE}/normas` },
          { rotulo: "ICMS por estado", href: `${BASE}/icms` },
          { rotulo: "Feriados", href: `${BASE}/feriados` },
        ]}
      />
      {children}
    </>
  );
}
