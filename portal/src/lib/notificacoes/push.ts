import "server-only";
import webpush, { WebPushError } from "web-push";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { envServidor } from "@/lib/env-servidor";

/** Serviços de notificação dos navegadores (Google, Mozilla, Apple e Microsoft). */
export const ENDPOINT_PUSH = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?\//i;

export function pushConfigurado() {
  return envServidor.push() !== null;
}

/** Só caminhos do próprio portal (nunca um endereço externo) chegam ao aparelho. */
function caminhoSeguro(link: string | null) {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : "/notificacoes";
}

function resumir(texto: string | null, limite = 240) {
  if (!texto) return "";
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

/** Conteúdo entregue ao aparelho (cifrado de ponta a ponta pelo protocolo Web Push). */
export function montarConteudo(n: { id: string; titulo: string; corpo: string | null; link: string | null; created_at: string }) {
  return JSON.stringify({
    titulo: n.titulo,
    corpo: resumir(n.corpo),
    url: caminhoSeguro(n.link),
    // Mesmo aviso (ex.: "enviou 3 arquivos") substitui o anterior na tela do aparelho.
    tag: `aviso-${n.id}`,
    quando: Date.parse(n.created_at) || Date.now(),
  });
}

/**
 * Entrega um aviso nos aparelhos ativados da pessoa. Sem as chaves VAPID o
 * envio NÃO é simulado: a tarefa termina como "não configurado".
 */
export async function executarPush(admin: ClienteAdmin, job: Job) {
  const notificacaoId = (job.payload as { notificacao_id?: string })?.notificacao_id;
  if (!notificacaoId) return { ignorado: "sem notificacao_id" };
  const cfg = envServidor.push();
  if (!cfg) return { status: "nao_configurado" };

  const { data: n } = await admin
    .from("notificacoes")
    .select("id, titulo, corpo, link, lida_em, created_at")
    .eq("id", notificacaoId)
    .maybeSingle();
  if (!n || n.lida_em) return { ignorado: "aviso lido ou removido" };

  const { data: destinos, error } = await admin.rpc("sistema_push_destinos", { p_notificacao_id: notificacaoId });
  if (error) throw new Error(`Falha ao consultar aparelhos: ${error.message}`);
  if (!destinos?.length) return { entregues: 0 };

  const conteudo = montarConteudo(n);
  let entregues = 0;
  let temporarias = 0;
  for (const d of destinos) {
    if (!ENDPOINT_PUSH.test(d.endpoint)) {
      await admin.rpc("sistema_push_resultado", { p_aparelho_id: d.aparelho_id, p_entregue: false, p_remover: true });
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.chave_p256dh, auth: d.chave_auth } }, conteudo, {
        vapidDetails: { subject: cfg.assunto, publicKey: cfg.publica, privateKey: cfg.privada },
        TTL: 24 * 60 * 60,
        urgency: "high",
        // Aparelho desligado recebe só a versão mais recente do mesmo aviso.
        topic: n.id.replace(/-/g, ""),
        timeout: 10_000,
        proxy: process.env.HTTPS_PROXY || undefined,
      });
      entregues++;
      await admin.rpc("sistema_push_resultado", { p_aparelho_id: d.aparelho_id, p_entregue: true });
    } catch (e) {
      const status = e instanceof WebPushError ? e.statusCode : 0;
      // 404/410: o navegador cancelou a inscrição (permissão retirada, app removido).
      const expirado = status === 404 || status === 410;
      if (!expirado) temporarias++;
      await admin.rpc("sistema_push_resultado", { p_aparelho_id: d.aparelho_id, p_entregue: false, p_remover: expirado });
      console.error(`[push] aviso ${n.id} não entregue (status ${status || "sem resposta"}):`, e instanceof Error ? e.message : e);
    }
  }
  // Nenhum aparelho recebeu por falha temporária: a fila tenta de novo mais tarde.
  if (entregues === 0 && temporarias > 0) throw new Error("Serviço de notificação indisponível no momento.");
  return { entregues, falhas: temporarias };
}
