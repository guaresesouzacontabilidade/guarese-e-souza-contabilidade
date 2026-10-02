import "server-only";

/** Configurações exclusivas do servidor. Nunca importe este arquivo em componentes de cliente. */
export const envServidor = {
  supabaseChaveSecreta: (): string => {
    const v = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!v) {
      throw new Error("SUPABASE_SECRET_KEY não configurada (chave secreta do projeto Supabase).");
    }
    return v;
  },
  cronSecret: (): string | null => process.env.CRON_SECRET || null,
  smtp: () => {
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    return {
      host,
      porta: Number(process.env.SMTP_PORT ?? 587),
      seguro: process.env.SMTP_SECURE === "true",
      usuario: process.env.SMTP_USER || undefined,
      senha: process.env.SMTP_PASS || undefined,
      remetente: process.env.SMTP_FROM ?? "Portal Guarese's ON <nao-responda@localhost>",
    };
  },
  /** Notificações no aparelho (Web Push). Sem as chaves VAPID, fica desconectado. */
  push: () => {
    const publica = process.env.VAPID_PUBLIC_KEY?.trim();
    const privada = process.env.VAPID_PRIVATE_KEY?.trim();
    if (!publica || !privada) return null;
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
    // Contato do remetente exigido pelos serviços de notificação (https: ou mailto:).
    const assunto = process.env.VAPID_SUBJECT?.trim() || (site.startsWith("https://") ? site : "mailto:nao-responda@localhost");
    return { publica, privada, assunto };
  },
  whatsapp: () => {
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) return null;
    return { token, versaoApi: process.env.WHATSAPP_API_VERSION ?? "v21.0" };
  },
  clamav: () => {
    const host = process.env.CLAMAV_HOST;
    if (!host) return null;
    return { host, porta: Number(process.env.CLAMAV_PORT ?? 3310) };
  },
  ocrAtivo: (): boolean => process.env.OCR_ATIVO !== "false",
  ocrCaminhoIdiomas: (): string | undefined => process.env.OCR_CAMINHO_IDIOMAS || undefined,
};
