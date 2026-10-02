export const STATUS_SOLICITACAO: Record<string, { rotulo: string; tom: "info" | "alerta" | "sucesso" | "neutro" | "primario" }> = {
  aberta: { rotulo: "Aberta", tom: "info" },
  em_andamento: { rotulo: "Em andamento", tom: "primario" },
  aguardando_cliente: { rotulo: "Aguardando a empresa", tom: "alerta" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

export const AREAS_SERVICO: Record<string, string> = {
  societario: "Societário",
  pessoal: "Departamento pessoal",
  contabil: "Contábil",
  fiscal: "Fiscal",
  outros: "Outros",
};

export const EM_ABERTO = ["aberta", "em_andamento", "aguardando_cliente"];
