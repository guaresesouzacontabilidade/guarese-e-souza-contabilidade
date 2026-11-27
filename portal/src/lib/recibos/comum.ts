/** Partes do recibo de honorários usadas tanto na tela quanto no PDF. */

export const FORMAS_PAGAMENTO: Record<string, string> = {
  pix: "PIX",
  dinheiro: "dinheiro",
  transferencia: "transferência bancária",
  boleto: "boleto",
  cartao: "cartão",
  cheque: "cheque",
};

/** 7/2026 → "007/2026". */
export const numeroRecibo = (r: { ano: number; numero: number }) => `${String(r.numero).padStart(3, "0")}/${r.ano}`;
