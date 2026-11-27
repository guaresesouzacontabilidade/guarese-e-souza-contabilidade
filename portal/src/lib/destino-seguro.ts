const BASE = "https://portal.invalido";

/**
 * Garante que um destino de redirecionamento é interno (evita open redirect).
 * Recusa endereços de outro site, inclusive os disfarçados com barra
 * invertida, espaços ou caracteres invisíveis (o navegador apaga tab e quebra
 * de linha, e "/\t/site.com" viraria "//site.com").
 */
export function destinoSeguro(destino: string | null | undefined, padrao = "/painel") {
  if (!destino || destino.length > 2000) return padrao;
  if (!destino.startsWith("/") || /[\\\s\u0000-\u001f\u007f]/.test(destino) || destino.startsWith("//")) return padrao;
  try {
    const url = new URL(destino, BASE);
    if (url.origin !== BASE) return padrao;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return padrao;
  }
}
