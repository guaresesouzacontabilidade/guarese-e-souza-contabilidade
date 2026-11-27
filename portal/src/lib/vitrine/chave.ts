import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Chave do site da loja: mostrada uma única vez no portal e guardada no banco
 * só como hash (SHA-256). O site a envia em "Authorization: Bearer lj_...".
 */
export function gerarChaveSite() {
  const chave = `lj_${randomBytes(32).toString("base64url")}`;
  return { chave, hash: hashChave(chave), inicio: chave.slice(0, 10) };
}

export function hashChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

/** Chave enviada pelo site no cabeçalho Authorization (ou null se ausente ou fora do formato). */
export function chaveDaRequisicao(req: Request): string | null {
  const m = /^Bearer\s+(lj_[A-Za-z0-9_-]{20,100})$/.exec((req.headers.get("authorization") ?? "").trim());
  return m ? m[1] : null;
}

export const SLUG_LOJA = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
