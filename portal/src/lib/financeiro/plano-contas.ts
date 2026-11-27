/**
 * Regras do plano de contas usadas nas telas: tipos que entram no DRE,
 * natureza (receita ou despesa) e o próximo código livre de um grupo.
 */

/** Tipos de conta que aparecem no DRE (os demais ficam fora do resultado). */
export const TIPOS_DRE = [
  "receita_operacional",
  "deducao_receita",
  "custo_mercadoria",
  "custo_servico",
  "despesa_operacional",
  "receita_financeira",
  "despesa_financeira",
  "outras_receitas",
  "outras_despesas",
  "impostos_lucro",
] as const;

const TIPOS_RECEITA = new Set(["receita_operacional", "receita_financeira", "outras_receitas", "aporte_socio", "emprestimo_captacao"]);

export function naturezaDoTipo(tipo: string): "receita" | "despesa" {
  return TIPOS_RECEITA.has(tipo) ? "receita" : "despesa";
}

export function tipoEntraNoDre(tipo: string): boolean {
  return (TIPOS_DRE as readonly string[]).includes(tipo);
}

interface ContaCodigo {
  id: string;
  codigo: string;
  pai_id: string | null;
  sintetica: boolean;
}

/**
 * Próximo código livre.
 * - Grupo (sem pai): o próximo número inteiro depois do maior grupo ("9", "10").
 * - Conta dentro de um grupo: código do grupo + ponto + dois dígitos, depois da
 *   maior conta numerada abaixo de 99 ("4.13"); "x.99" fica para "Outras".
 * - Conta sem grupo: "0.01", "0.02"...
 */
export function proximoCodigo(contas: ContaCodigo[], paiId: string | null, grupo = false): string {
  const usados = new Set(contas.map((c) => c.codigo));
  if (grupo) {
    const maior = contas
      .filter((c) => c.sintetica || !c.codigo.includes("."))
      .map((c) => Number.parseInt(c.codigo.split(".")[0], 10))
      .filter((n) => Number.isFinite(n))
      .reduce((a, b) => Math.max(a, b), 0);
    let n = maior + 1;
    while (usados.has(String(n))) n++;
    return String(n);
  }
  const pai = paiId ? contas.find((c) => c.id === paiId) : null;
  const prefixo = pai ? pai.codigo : "0";
  const sufixos = contas
    .filter((c) => c.codigo.startsWith(`${prefixo}.`))
    .map((c) => Number.parseInt(c.codigo.slice(prefixo.length + 1), 10))
    .filter((n) => Number.isFinite(n) && n < 99);
  let n = (sufixos.length ? Math.max(...sufixos) : 0) + 1;
  const formatar = (x: number) => `${prefixo}.${String(x).padStart(2, "0")}`;
  while (usados.has(formatar(n)) || n === 99) n++;
  return formatar(n);
}
