/**
 * Grupos de CFOP usados pelo auditor (mesmas regras das funções app.cfop_*
 * do banco, usadas na previsão de impostos; no banco, app.cfop_compra e
 * app.cfop_devolucao_venda já incluem as notas de terceiros, como as funções
 * "NaEntrada" daqui).
 */
const t = (c: string | null | undefined) => (c ?? "").trim();

export function cfopVenda(c: string | null | undefined) {
  const v = t(c);
  return /^[567]1\d{2}$/.test(v) || /^[56]40[1-5]$/.test(v) || /^[567]65[1-6]$/.test(v) || /^[56]667$/.test(v);
}

/** Venda de mercadoria com ICMS já retido por substituição tributária (contribuinte substituído). */
export function cfopVendaSt(c: string | null | undefined) {
  return ["5405", "6404", "5656", "6656"].includes(t(c));
}

export function cfopDevolucaoVenda(c: string | null | undefined) {
  const v = t(c);
  return /^[123]20[1-4]$/.test(v) || /^[12]41[01]$/.test(v) || /^[12]66[0-2]$/.test(v);
}

export function cfopCompra(c: string | null | undefined) {
  const v = t(c);
  return /^[123]1\d{2}$/.test(v) || /^[12]40[1-3]$/.test(v) || /^[123]65[1-3]$/.test(v);
}

/**
 * Compra registrada numa nota de entrada: na nota do fornecedor o CFOP é o
 * da venda dele (5.102, 6.102, 5.405...), sem as transferências entre
 * estabelecimentos (x.15x); na nota de entrada emitida pela própria empresa,
 * o de compra (1.102, 2.102...). Igual a app.cfop_compra no banco.
 */
export function cfopCompraNaEntrada(c: string | null | undefined) {
  const v = t(c);
  return cfopCompra(v) || (cfopVenda(v) && !/^[567]15\d$/.test(v));
}

/**
 * Devolução de venda numa nota de entrada: emitida pela própria empresa
 * (1.202, 2.202...) ou pelo cliente que devolveu (5.202, 6.202, 5.411...).
 * Igual a app.cfop_devolucao_venda no banco.
 */
export function cfopDevolucaoNaEntrada(c: string | null | undefined) {
  const v = t(c);
  return cfopDevolucaoVenda(v) || /^[56]20[12]$/.test(v) || /^[56]210$/.test(v) || /^[56]41[0-3]$/.test(v) || /^[56]55[36]$/.test(v) || /^[56]66[0-2]$/.test(v);
}

/** Venda de produção do próprio estabelecimento (indústria): fora da revenda à alíquota zero. */
const PRODUCAO_PROPRIA = new Set(["101", "103", "105", "109", "111", "116", "118", "122", "124", "125", "401", "402", "651", "652", "653", "654"]);

/** Revenda de mercadoria adquirida de terceiros. */
export function cfopRevenda(c: string | null | undefined) {
  return cfopVenda(c) && !PRODUCAO_PROPRIA.has(t(c).slice(1));
}
