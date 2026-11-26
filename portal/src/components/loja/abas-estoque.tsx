import { AbasLink } from "@/components/ui/abas";

/** Abas de Produtos e estoque. Preços e análise mostram custos: só quem gerencia a loja. */
export function AbasEstoque({ empresaId, ativa, gerente }: { empresaId: string; ativa: "produtos" | "precos" | "analise"; gerente: boolean }) {
  if (!gerente) return null;
  const base = `/e/${empresaId}/loja/produtos`;
  return (
    <AbasLink
      ativa={ativa}
      abas={[
        { valor: "produtos", rotulo: "Produtos", href: base },
        { valor: "precos", rotulo: "Preços de venda", href: `${base}/precos` },
        { valor: "analise", rotulo: "Reposição e análise", href: `${base}/analise` },
      ]}
    />
  );
}
