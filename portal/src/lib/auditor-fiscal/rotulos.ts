type Tom = "neutro" | "primario" | "sucesso" | "alerta" | "perigo" | "info" | "contorno";

export const ROTULO_REGRA: Record<string, string> = {
  monofasico_simples: "PIS/Cofins monofásico no DAS",
  st_simples: "ICMS-ST no DAS",
  monofasico_regime_normal: "PIS/Cofins na revenda de monofásicos",
  icms_st_regime_normal: "ICMS em produto com ST",
  st_sem_compra_st: "Venda como ST sem compra com ST",
  ibscbs_ausente: "Notas sem IBS/CBS",
  ibscbs_aliquota: "Alíquota de teste do IBS/CBS",
  ncm_invalido: "NCM inválido",
};

export const TIPO_ACHADO: Record<string, { rotulo: string; tom: Tom }> = {
  oportunidade: { rotulo: "Oportunidade", tom: "sucesso" },
  risco: { rotulo: "Risco", tom: "alerta" },
  informativo: { rotulo: "Informativo", tom: "info" },
};

export const CONFIANCA: Record<string, { rotulo: string; tom: Tom; descricao: string }> = {
  alta: { rotulo: "Confiança alta", tom: "sucesso", descricao: "Produto na lista da lei ou comprado com o código fiscal que confirma o enquadramento." },
  media: { rotulo: "Confiança média", tom: "info", descricao: "Indício forte, mas falta um dado (receita de algum mês, anexo do Simples ou o produto exato)." },
  conferir: { rotulo: "Conferir", tom: "alerta", descricao: "Depende de uma condição que só o contador confirma (destinação, enquadramento, legislação do Estado)." },
};

export const SITUACAO_ACHADO: Record<string, { rotulo: string; tom: Tom }> = {
  novo: { rotulo: "Para revisar", tom: "alerta" },
  confirmado: { rotulo: "Confirmado", tom: "info" },
  descartado: { rotulo: "Descartado", tom: "neutro" },
  publicado: { rotulo: "Publicado ao cliente", tom: "primario" },
  resolvido: { rotulo: "Concluído", tom: "sucesso" },
};

export const SITUACAO_EXECUCAO: Record<string, { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: "Na fila", tom: "info" },
  processando: { rotulo: "Analisando", tom: "info" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  erro: { rotulo: "Erro", tom: "perigo" },
};

export const ORIGEM_EXECUCAO: Record<string, string> = {
  automatica: "notas novas",
  manual: "pedida pela equipe",
  mensal: "reanálise do mês",
};

/** Filtros da lista de achados (equipe). */
export const FILTROS_SITUACAO: Record<string, { rotulo: string; situacoes: string[] }> = {
  abertos: { rotulo: "Em aberto", situacoes: ["novo", "confirmado"] },
  publicados: { rotulo: "Publicados", situacoes: ["publicado"] },
  concluidos: { rotulo: "Concluídos", situacoes: ["resolvido"] },
  descartados: { rotulo: "Descartados", situacoes: ["descartado"] },
  todos: { rotulo: "Todos", situacoes: ["novo", "confirmado", "publicado", "resolvido", "descartado"] },
};

/** Sugestão de mensagem ao cliente a partir do achado (a equipe pode editar antes de publicar). */
export function mensagemSugerida(a: { tipo: string; titulo: string; valor_estimado: number | string | null; competencia: string }, valor: string, mes: string) {
  if (a.tipo === "oportunidade") {
    return (
      `Analisamos as notas fiscais de ${mes} e encontramos impostos que podem ter sido pagos a mais: cerca de ${valor}. ` +
      `Podemos conferir a apuração e, se for o caso, pedir a restituição para a sua empresa. É só clicar em "Quero que o escritório cuide disso".`
    );
  }
  return (
    `Analisamos as notas fiscais de ${mes} e encontramos um ponto de atenção: ${a.titulo.replace(/ — .*$/, "").toLowerCase()}. ` +
    `Vamos orientar o ajuste no sistema de emissão para evitar multas.`
  );
}
