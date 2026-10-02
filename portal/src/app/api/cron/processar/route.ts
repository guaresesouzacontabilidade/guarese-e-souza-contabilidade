import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/jobs/autorizacao-cron";
import { processarFila } from "@/lib/jobs/executor";

export const maxDuration = 60;

/**
 * Processa a fila de tarefas (leitura de documentos, e-mails, sugestões de
 * conciliação). Chamado a cada poucos minutos pelo agendador do banco
 * (pg_cron) ou da hospedagem.
 */
async function executar(req: Request) {
  if (!cronAutorizado(req)) return new NextResponse("Não autorizado.", { status: 401 });
  const r = await processarFila({ limite: 100, tempoMaximoMs: 50_000 });
  return NextResponse.json({ ok: true, ...r });
}

export const GET = executar;
export const POST = executar;
