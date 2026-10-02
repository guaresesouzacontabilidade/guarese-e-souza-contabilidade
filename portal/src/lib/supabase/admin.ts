import "server-only";
import { createClient } from "@supabase/supabase-js";
import { envPublico } from "@/lib/env";
import { envServidor } from "@/lib/env-servidor";
import type { Database } from "./database.types";

/**
 * Cliente com a chave secreta (ignora RLS). Uso restrito a:
 *  - convites e administração de usuários no Supabase Auth;
 *  - URLs de envio assinadas (após validação de permissão pelo RPC do usuário);
 *  - processamento em segundo plano (fila de tarefas).
 * Nunca use este cliente para atender diretamente a uma consulta do usuário.
 */
export function criarClienteAdmin() {
  return createClient<Database>(envPublico.supabaseUrl(), envServidor.supabaseChaveSecreta(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type ClienteAdmin = ReturnType<typeof criarClienteAdmin>;
