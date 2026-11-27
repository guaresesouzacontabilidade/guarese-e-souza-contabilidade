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
 * apaga os lotes de XML vencidos (ficam 7 dias); nos honorários do
 * escritório, gera as cobranças do mês no dia escolhido e agenda os
 * lembretes da régua de cobrança (só em dia útil, às 9h); na clínica de
 * fisioterapia, programa as confirmações pelo WhatsApp dos atendimentos do dia;
 * na Gestão de RH, gera a tarefa do período atual de cada rotina da equipe.
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
  // Robô de planejamento tributário: um estudo por empresa ativa (pela fila)
  const estudos = await admin.rpc("rotina_estudos");
  // Honorários do escritório: cobranças do mês no dia escolhido e lembretes da régua (dias úteis)
  const honorarios = await admin.rpc("rotina_honorarios");
  // Clínica de fisioterapia: confirmações pelo WhatsApp dos atendimentos de hoje (saem no horário da clínica)
  const fisio = await admin.rpc("rotina_fisio_confirmacoes");
  // Suporte 24h: apaga as perguntas registradas há mais de 180 dias
  const suporte = await admin.rpc("rotina_suporte_limpeza");
  // Gestão de RH: a tarefa do período atual de cada rotina da equipe (não duplica)
  const rh = await admin.rpc("rotina_rh_tarefas");
  const resultado = {
    ...(data as Record<string, unknown>),
    obrigacoes: operacional.data,
    vencimentos: vencimentos.error ? { erro: vencimentos.error.message } : vencimentos.data,
    notas_automaticas: notas.error ? { erro: notas.error.message } : notas.data,
    auditor_fiscal: auditor.error ? { erro: auditor.error.message } : auditor.data,
    lotes_xml: lotes.error ? { erro: lotes.error.message } : lotes.data,
    estudos_tributarios: estudos.error ? { erro: estudos.error.message } : estudos.data,
    honorarios: honorarios.error ? { erro: honorarios.error.message } : honorarios.data,
    fisio_confirmacoes: fisio.error ? { erro: fisio.error.message } : fisio.data,
    suporte_limpeza: suporte.error ? { erro: suporte.error.message } : suporte.data,
    rh_tarefas: rh.error ? { erro: rh.error.message } : rh.data,
  };
  await registrarRotina(admin, "diaria", { ok: true, resultado });
  const fila = await processarFila({ limite: 50, tempoMaximoMs: 30_000 });
  return NextResponse.json({ ok: true, rotina: resultado, fila });
}

export const GET = executar;
export const POST = executar;
