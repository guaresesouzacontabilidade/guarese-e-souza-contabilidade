import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/jobs/autorizacao-cron";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { processarFila, registrarRotina } from "@/lib/jobs/executor";

export const maxDuration = 60;

/**
 * Rotina diária: gera o checklist do mês, lançamentos recorrentes,
 * lembretes automáticos de pendências e limpa envios incompletos; na camada
 * operacional, gera as tarefas das obrigações (sem duplicar) e os alertas
 * de prazos para a equipe; avisa os vencimentos de certificados, alvarás,
 * licenças e certidões (30, 15 e 5 dias antes e no vencimento); garante a
 * próxima busca das notas automáticas das empresas com certificado; no dia 2
 * de cada mês, reanalisa as notas no auditor fiscal (a faixa do Simples muda);
 * apaga os lotes de XML vencidos (ficam 7 dias).
 */
async function executar(req: Request) {
  if (!cronAutorizado(req)) return new NextResponse("Não autorizado.", { status: 401 });
  const admin = criarClienteAdmin();
  const { data, error } = await admin.rpc("rotina_diaria");
  if (error) {
    await registrarRotina(admin, "diaria", { ok: false, erro: error.message });
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  const operacional = await admin.rpc("rotina_operacional");
  if (operacional.error) {
    await registrarRotina(admin, "diaria", { ok: false, resultado: data, erro: `Obrigações: ${operacional.error.message}` });
    return NextResponse.json({ ok: false, rotina: data, erro: operacional.error.message }, { status: 500 });
  }
  const vencimentos = await admin.rpc("rotina_vencimentos");
  const notas = await admin.rpc("rotina_notas_automaticas");
  const auditor = await admin.rpc("rotina_auditor_fiscal");
  const lotes = await admin.rpc("rotina_lotes_xml");
  const resultado = {
    ...(data as Record<string, unknown>),
    obrigacoes: operacional.data,
    vencimentos: vencimentos.error ? { erro: vencimentos.error.message } : vencimentos.data,
    notas_automaticas: notas.error ? { erro: notas.error.message } : notas.data,
    auditor_fiscal: auditor.error ? { erro: auditor.error.message } : auditor.data,
    lotes_xml: lotes.error ? { erro: lotes.error.message } : lotes.data,
  };
  await registrarRotina(admin, "diaria", { ok: true, resultado });
  const fila = await processarFila({ limite: 50, tempoMaximoMs: 30_000 });
  return NextResponse.json({ ok: true, rotina: resultado, fila });
}

export const GET = executar;
export const POST = executar;
