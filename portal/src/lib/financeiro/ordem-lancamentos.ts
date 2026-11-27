export type OrdemLancamentos = "crescente" | "decrescente";

/**
 * Ordem das contas a pagar e a receber (tela e planilha): a escolhida pela
 * pessoa; sem escolha, da data mais antiga para a mais nova (o vencimento de
 * hoje antes do de 2027), e o histórico (quitadas e canceladas) da mais nova
 * para a mais antiga.
 */
export function ordemLancamentos(ordem: string | null | undefined, situacao: string | null | undefined): OrdemLancamentos {
  if (ordem === "crescente" || ordem === "decrescente") return ordem;
  return situacao === "quitado" || situacao === "cancelado" ? "decrescente" : "crescente";
}
