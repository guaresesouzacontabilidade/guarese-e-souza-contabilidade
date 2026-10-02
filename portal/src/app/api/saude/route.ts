import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { envPublico } from "@/lib/env";

/** Verificação simples de funcionamento (usada no monitoramento). Não expõe dados. */
export async function GET() {
  const inicio = Date.now();
  let banco = "ok";
  try {
    const anon = createClient(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), { auth: { persistSession: false } });
    const { error } = await anon.rpc("escritorio_publico");
    if (error) banco = "indisponivel";
  } catch {
    banco = "indisponivel";
  }
  return NextResponse.json({ ok: banco === "ok", banco, ms: Date.now() - inicio }, { status: banco === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
