/** Rótulos dos contratos (tela e servidor). */
export const SITUACOES_CONTRATO = {
  rascunho: { rotulo: "Para conferir", tom: "neutro" },
  enviado: { rotulo: "Aguardando assinatura", tom: "alerta" },
  assinado: { rotulo: "Assinado", tom: "sucesso" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
} as const;

export const TIPOS_CONTRATO = { contrato: "Contrato", aditivo: "Aditivo", distrato: "Distrato" } as const;

export const numeroContrato = (c: { ano: number; numero: number }) => `${String(c.numero).padStart(4, "0")}/${c.ano}`;
