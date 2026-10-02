import "server-only";
import { criarClienteAdmin, type ClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Manipulador = (admin: ClienteAdmin, job: Job) => Promise<unknown>;

/** Registro dos tipos de tarefa (carregados sob demanda). */
const MANIPULADORES: Record<string, () => Promise<Manipulador>> = {
  enviar_envio: async () => (await import("@/lib/notificacoes/envio")).executarEnvio,
  enviar_push: async () => (await import("@/lib/notificacoes/push")).executarPush,
  processar_documento: async () => (await import("@/lib/documentos/processar")).processarDocumento,
  sugerir_conciliacao: async () => (await import("@/lib/conciliacao/motor")).executarSugestoes,
  remover_arquivos: async () => (await import("@/lib/documentos/processar")).removerArquivos,
  notas_automaticas: async () => (await import("@/lib/notas-automaticas/sincronizar")).executarNotasAutomaticas,
};

function espera(tentativas: number) {
  // 1 min, 5 min, 15 min, 1 h...
  return [60, 300, 900, 3600, 7200][Math.min(tentativas - 1, 4)];
}

export async function processarFila({
  limite = 50,
  tempoMaximoMs = 50_000,
  tipos,
}: { limite?: number; tempoMaximoMs?: number; tipos?: string[] } = {}) {
  const admin = criarClienteAdmin();
  const worker = `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const inicio = Date.now();
  let processados = 0;
  let falhas = 0;

  while (Date.now() - inicio < tempoMaximoMs && processados < limite) {
    const { data: jobs, error } = await admin.rpc("jobs_reservar", { p_limite: 5, p_worker: worker, p_tipos: tipos ?? undefined });
    if (error) throw new Error(`Falha ao reservar tarefas: ${error.message}`);
    if (!jobs?.length) break;
    for (const job of jobs as Job[]) {
      const carregar = MANIPULADORES[job.tipo];
      try {
        if (!carregar) throw new Error(`Tipo de tarefa desconhecido: ${job.tipo}`);
        const manipulador = await carregar();
        const resultado = await manipulador(admin, job);
        await admin.rpc("jobs_concluir", { p_id: job.id, p_resultado: (resultado ?? null) as never });
      } catch (e) {
        falhas++;
        const mensagem = e instanceof Error ? e.message : String(e);
        console.error(`[fila] tarefa ${job.id} (${job.tipo}) falhou:`, mensagem);
        await admin.rpc("jobs_falhar", {
          p_id: job.id,
          p_erro: mensagem,
          p_reprogramar_segundos: job.tentativas < job.max_tentativas ? espera(job.tentativas) : undefined,
        });
      }
      processados++;
    }
  }
  return { processados, falhas };
}

/** Guarda a última execução de uma rotina agendada (exibida em Configurações → Integrações). */
export async function registrarRotina(
  admin: ClienteAdmin,
  rotina: "fila" | "diaria",
  r: { ok: boolean; resultado?: unknown; erro?: string },
) {
  await admin
    .from("rotinas_status")
    .upsert({ rotina, ultima_execucao: new Date().toISOString(), ok: r.ok, resultado: (r.resultado ?? null) as never, erro: r.erro ?? null });
}
