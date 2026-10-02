import "server-only";
import { after } from "next/server";

/**
 * Processa a fila logo após a resposta ser enviada ao usuário (sem bloquear a
 * tela). As rotas de agendamento (/api/cron/*) e o processador dedicado
 * (npm run worker) garantem a execução caso esta chamada não aconteça.
 */
export function processarFilaDepois(opcoes?: { tipos?: string[]; limite?: number }) {
  after(async () => {
    try {
      const { processarFila } = await import("./executor");
      await processarFila({ limite: opcoes?.limite ?? 25, tempoMaximoMs: 25_000, tipos: opcoes?.tipos });
    } catch (e) {
      console.error("[fila] falha ao processar após a resposta:", e);
    }
  });
}
