import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/jobs/autorizacao-cron";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { processarFila, registrarRotina } from "@/lib/jobs/executor";

export const maxDuration = 60;

/**
 * Rotina diária: gera o checklist do mês, lançamentos recorrentes,
 * lembretes automáticos de pendências e limpa envios incompletos.
 */
async function executar(req: Request) {
  if (!cronAutorizado(req)) return new NextResponse("Não autorizado.", { status: 401 });
  const admin = criarClienteAdmin();
  const { data, error } = await admin.rpc("rotina_diaria");
  if (error) {
    await registrarRotina(admin, "diaria", { ok: false, erro: error.message });
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  await registrarRotina(admin, "diaria", { ok: true, resultado: data });
  const fila = await processarFila({ limite: 50, tempoMaximoMs: 30_000 });
  return NextResponse.json({ ok: true, rotina: data, fila });
}

export const GET = executar;
export const POST = executar;
