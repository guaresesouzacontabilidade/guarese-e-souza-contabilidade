import { AbasLink } from "@/components/ui/abas";

/** Abas de Produtos e estoque. Preços e análise mostram custos: só quem tem "Ver custos e margens". */
export function AbasEstoque({ empresaId, ativa, custos }: { empresaId: string; ativa: "produtos" | "precos" | "analise"; custos: boolean }) {
  if (!custos) return null;
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
