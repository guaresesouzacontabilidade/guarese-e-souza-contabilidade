import "server-only";
import { envServidor } from "@/lib/env-servidor";

/**
 * WhatsApp Business Platform (Cloud API oficial da Meta).
 * Mensagens iniciadas pela empresa exigem um modelo (template) aprovado.
 * Fica desconectado enquanto não houver token (WHATSAPP_TOKEN), número
 * (Phone Number ID) e nome do modelo configurados — nada é simulado.
 */
export interface ConfigWhatsapp {
  phoneNumberId: string | null;
  modelo: string | null;
  idioma: string;
}

export function whatsappConectado(cfg: ConfigWhatsapp) {
  return Boolean(envServidor.whatsapp() && cfg.phoneNumberId && cfg.modelo);
}

export function normalizarNumero(numero: string) {
  let d = numero.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

export async function enviarModeloWhatsapp(
  cfg: ConfigWhatsapp,
  para: string,
  parametros: string[],
): Promise<{ enviado: true; id: string | null } | { enviado: false; motivo: "nao_configurado" | "falhou"; erro?: string }> {
  const credencial = envServidor.whatsapp();
  if (!credencial || !cfg.phoneNumberId || !cfg.modelo) return { enviado: false, motivo: "nao_configurado" };
  const url = `https://graph.facebook.com/${credencial.versaoApi}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credencial.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizarNumero(para),
        type: "template",
        template: {
          name: cfg.modelo,
          language: { code: cfg.idioma || "pt_BR" },
          components: [{ type: "body", parameters: parametros.map((t) => ({ type: "text", text: t.slice(0, 1000) })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const corpo = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!resp.ok) return { enviado: false, motivo: "falhou", erro: corpo.error?.message ?? `HTTP ${resp.status}` };
    return { enviado: true, id: corpo.messages?.[0]?.id ?? null };
  } catch (e) {
    return { enviado: false, motivo: "falhou", erro: e instanceof Error ? e.message : String(e) };
  }
}
