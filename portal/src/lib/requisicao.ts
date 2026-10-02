import "server-only";
import { headers } from "next/headers";

/** IP e navegador da requisição atual (para auditoria). */
export async function dadosRequisicao() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim() || null;
  const userAgent = h.get("user-agent");
  return { ip, userAgent };
}

/** Garante que um destino de redirecionamento é interno (evita open redirect). */
export function destinoSeguro(destino: string | null | undefined, padrao = "/painel") {
  if (!destino) return padrao;
  if (!destino.startsWith("/") || destino.startsWith("//") || destino.startsWith("/\\")) return padrao;
  return destino;
}
