/**
 * Processador contínuo da fila de tarefas (opcional).
 *
 * Na hospedagem padrão (Vercel + Supabase), o agendador do banco (pg_cron)
 * chama /api/cron/processar a cada 5 minutos e /api/cron/diario uma vez por
 * dia — este script NÃO é necessário. Use-o quando quiser processar mais
 * rápido (servidor próprio) ou durante o desenvolvimento:
 *
 *   npm run worker
 *
 * Variáveis (lidas também de .env.local):
 *   PORTAL_URL                 endereço do portal (padrão: NEXT_PUBLIC_SITE_URL)
 *   CRON_SECRET                mesmo segredo configurado no portal
 *   WORKER_INTERVALO_SEGUNDOS  intervalo entre chamadas (padrão 30)
 *   WORKER_ROTINA_DIARIA       "1" para também rodar a rotina diária (às 6h)
 *
 * O segredo nunca é exibido no terminal.
 */
import { carregarEnv } from "./util-env";

carregarEnv();

const portal = (process.env.PORTAL_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const segredo = process.env.CRON_SECRET;
const intervalo = Math.max(5, Number(process.env.WORKER_INTERVALO_SEGUNDOS ?? 30)) * 1000;
const rotinaDiaria = process.env.WORKER_ROTINA_DIARIA === "1";
const HORA_ROTINA = 6;

if (!segredo) {
  console.error("CRON_SECRET não configurado. Defina a variável (o mesmo valor usado pelo portal).");
  process.exit(1);
}

let parar = false;
let esperaAtual: NodeJS.Timeout | null = null;
let acordar: (() => void) | null = null;
for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    console.log(`\nEncerrando (${sinal})...`);
    parar = true;
    if (esperaAtual) clearTimeout(esperaAtual);
    acordar?.();
  });
}

function dormir(ms: number) {
  return new Promise<void>((resolve) => {
    acordar = resolve;
    esperaAtual = setTimeout(resolve, ms);
  });
}

async function chamar(rota: "/api/cron/processar" | "/api/cron/diario") {
  const resp = await fetch(`${portal}${rota}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${segredo}` },
    signal: AbortSignal.timeout(120_000),
  });
  const corpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) throw new Error(`${rota} respondeu ${resp.status}${corpo.erro ? `: ${String(corpo.erro)}` : ""}`);
  return corpo;
}

/** Data de hoje no fuso do escritório (America/Araguaina). */
function hojeLocal() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { data: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")) };
}

async function principal() {
  console.log(`Processador da fila: ${portal} (a cada ${intervalo / 1000}s${rotinaDiaria ? `, rotina diária às ${HORA_ROTINA}h` : ""}). Ctrl+C para sair.`);
  let ultimaDiaria = "";
  let falhasSeguidas = 0;
  while (!parar) {
    try {
      if (rotinaDiaria) {
        const { data, hora } = hojeLocal();
        if (hora >= HORA_ROTINA && ultimaDiaria !== data) {
          const r = await chamar("/api/cron/diario");
          ultimaDiaria = data;
          console.log(`[${new Date().toISOString()}] rotina diária:`, JSON.stringify(r.rotina ?? r));
        }
      }
      const r = await chamar("/api/cron/processar");
      if (Number(r.processados) > 0) console.log(`[${new Date().toISOString()}] tarefas processadas: ${r.processados} (falhas: ${r.falhas ?? 0})`);
      falhasSeguidas = 0;
    } catch (e) {
      falhasSeguidas++;
      console.error(`[${new Date().toISOString()}] falha: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Em caso de falhas seguidas, espera mais (até 5 minutos)
    await dormir(Math.min(intervalo * 2 ** Math.min(falhasSeguidas, 4), 300_000));
  }
}

principal().then(() => process.exit(0));
