/** Código curto para conferir a declaração no portal (aparece no rodapé do PDF). */
export function codigoDeclaracao(id: string) {
  return id.replace(/-/g, "").slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}
