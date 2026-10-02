import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { envPublico } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Cliente Supabase no servidor com a sessão do usuário (cookies).
 * Todas as consultas feitas com este cliente passam pelas políticas RLS.
 */
export async function criarClienteServidor() {
  const cookieStore = await cookies();
  return createServerClient<Database>(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesParaGravar) {
        try {
          for (const { name, value, options } of cookiesParaGravar) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado a partir de um Server Component: o proxy renova a sessão.
        }
      },
    },
  });
}

export type ClienteSupabase = Awaited<ReturnType<typeof criarClienteServidor>>;
