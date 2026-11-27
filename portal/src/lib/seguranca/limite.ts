import "server-only";
import { createHash } from "node:crypto";
import { criarClienteAdmin } from "@/lib/supabase/admin";

/**
 * Limite de tentativas guardado no banco (vale para todos os servidores do
 * portal). O e-mail e o IP viram um código embaralhado antes de sair daqui.
 * Se o banco não responder, a pessoa não é barrada por causa do limite.
 */

export function chaveLimite(tipo: string, valor: string) {
  return `${tipo}:${createHash("sha256").update(valor.trim().toLowerCase()).digest("hex").slice(0, 40)}`;
}

/** Soma uma tentativa; devolve false quando passou do limite na janela. */
export async function consumirLimite(chave: string, maximo: number, janelaSegundos: number): Promise<boolean> {
  try {
    const { data, error } = await criarClienteAdmin().rpc("limite_consumir", { p_chave: chave, p_maximo: maximo, p_janela_segundos: janelaSegundos });
    return error ? true : data !== false;
  } catch {
    return true;
  }
}

/** O limite já foi atingido? (não soma tentativa) */
export async function limiteEstourado(chave: string, maximo: number): Promise<boolean> {
  try {
    const { data, error } = await criarClienteAdmin().rpc("limite_estourado", { p_chave: chave, p_maximo: maximo });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function zerarLimite(chave: string): Promise<void> {
  try {
    await criarClienteAdmin().rpc("limite_zerar", { p_chave: chave });
  } catch {
    // sem efeito na entrada
  }
}
