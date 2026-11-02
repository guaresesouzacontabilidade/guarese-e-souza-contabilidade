/** Rótulos do robô de planejamento tributário (usados nas telas, no PDF e no servidor). */
export type TipoEstudo = "regime" | "fator_r" | "imposto_pago_a_mais" | "limite_simples";
export type EstadoEstudo = "oportunidade" | "alerta" | "nada_a_fazer" | "faltam_dados";
export type SituacaoEstudo = "nova" | "aprovada" | "descartada" | "apresentada";
type Tom = "neutro" | "primario" | "sucesso" | "alerta" | "perigo" | "info";

export const TIPOS_ESTUDO: { tipo: TipoEstudo; nome: string; explica: string }[] = [
  { tipo: "regime", nome: "Regime mais barato", explica: "Compara Simples Nacional, Lucro Presumido e Lucro Real com os últimos 12 meses da empresa." },
  { tipo: "fator_r", nome: "Fator R (pró-labore × Anexo do Simples)", explica: "Serviços do Anexo V que podem ir para o Anexo III aumentando a folha, já descontado o INSS do pró-labore." },
  { tipo: "imposto_pago_a_mais", nome: "Imposto pago a mais", explica: "Soma o que o auditor fiscal encontrou nas notas (monofásico, ST e serviços) nos últimos 5 anos." },
  { tipo: "limite_simples", nome: "Limite do Simples Nacional", explica: "Projeta a receita do ano e avisa antes do sublimite (R$ 3,6 milhões) e do limite (R$ 4,8 milhões)." },
];

export const NOME_TIPO: Record<string, string> = Object.fromEntries(TIPOS_ESTUDO.map((t) => [t.tipo, t.nome]));

export const ESTADO_ESTUDO: Record<string, { rotulo: string; tom: Tom }> = {
  oportunidade: { rotulo: "Oportunidade", tom: "sucesso" },
  alerta: { rotulo: "Alerta", tom: "alerta" },
  nada_a_fazer: { rotulo: "Nada a fazer", tom: "neutro" },
  faltam_dados: { rotulo: "Faltam dados", tom: "info" },
};

export const SITUACAO_ESTUDO: Record<string, { rotulo: string; tom: Tom }> = {
  nova: { rotulo: "Para revisar", tom: "alerta" },
  aprovada: { rotulo: "Aprovada", tom: "sucesso" },
  apresentada: { rotulo: "Apresentada ao cliente", tom: "primario" },
  descartada: { rotulo: "Descartada", tom: "neutro" },
};

export const SITUACAO_EXECUCAO_ESTUDO: Record<string, { rotulo: string; tom: Tom }> = {
  na_fila: { rotulo: "Na fila", tom: "info" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  erro: { rotulo: "Erro", tom: "perigo" },
};

/** Execução pedida há pouco e ainda na fila (depois de 15 minutos, considera parada). */
export function estudandoAgora(x: { situacao: string; iniciado_em: string }) {
  return x.situacao === "na_fila" && Date.now() - new Date(x.iniciado_em).getTime() < 15 * 60_000;
}
