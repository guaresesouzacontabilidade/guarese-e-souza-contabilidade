import { SubNavegacao } from "@/components/ui/subnav";

/** Abas da ferramenta de escalas. */
export function NavegacaoEscalas({ empresaId, gerenciar }: { empresaId: string; gerenciar: boolean }) {
  const base = `/e/${empresaId}/escalas`;
  return (
    <SubNavegacao
      className="mb-5"
      itens={[
        { rotulo: "Escalas", href: base, exato: true },
        ...(gerenciar ? [{ rotulo: "Funcionários", href: `${base}/funcionarios` }] : []),
        { rotulo: "Modelos de escala", href: `${base}/modelos` },
      ]}
    />
  );
}
