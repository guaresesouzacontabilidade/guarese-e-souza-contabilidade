import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/jobs/autorizacao-cron";
import { processarFila, registrarRotina } from "@/lib/jobs/executor";
import { criarClienteAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Processa a fila de tarefas (leitura de documentos, e-mails, sugestões de
 * conciliação). Chamado a cada poucos minutos pelo agendador do banco
 * (pg_cron) ou da hospedagem.
 */
async function executar(req: Request) {
  if (!cronAutorizado(req)) return new NextResponse("Não autorizado.", { status: 401 });
  const admin = criarClienteAdmin();
  try {
    // Pix pelo banco (Sicredi): confere os recebidos a cada 15 minutos, caso o aviso do banco falhe
    await (await import("@/lib/honorarios/banco")).agendarConferenciaPeriodica(admin).catch(() => undefined);
    const r = await processarFila({ limite: 100, tempoMaximoMs: 50_000 });
    await registrarRotina(admin, "fila", { ok: true, resultado: r });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await registrarRotina(admin, "fila", { ok: false, erro });
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}

export const GET = executar;
export const POST = executar;
