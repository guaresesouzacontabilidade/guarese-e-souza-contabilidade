import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { envServidor } from "@/lib/env-servidor";
import { modeloEmail, type DadosModeloEmail } from "./modelo";

export type ResultadoEnvio =
  | { enviado: true; id: string | null }
  | { enviado: false; motivo: "nao_configurado" | "falhou"; erro?: string };

let transporte: Transporter | null = null;

function obterTransporte() {
  const cfg = envServidor.smtp();
  if (!cfg) return null;
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.porta,
      secure: cfg.seguro,
      auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.senha } : undefined,
    });
  }
  return { transporte, remetente: cfg.remetente };
}

export function emailConfigurado() {
  return envServidor.smtp() !== null;
}

/**
 * Envia e-mail pelo SMTP configurado. Quando o SMTP não está configurado,
 * NÃO simula o envio: retorna { enviado: false, motivo: "nao_configurado" }.
 */
export async function enviarEmail(para: string, assunto: string, conteudo: DadosModeloEmail): Promise<ResultadoEnvio> {
  const t = obterTransporte();
  if (!t) return { enviado: false, motivo: "nao_configurado" };
  const { html, texto } = modeloEmail(conteudo);
  try {
    const info = await t.transporte.sendMail({ from: t.remetente, to: para, subject: assunto, html, text: texto });
    return { enviado: true, id: info.messageId ?? null };
  } catch (e) {
    return { enviado: false, motivo: "falhou", erro: e instanceof Error ? e.message : String(e) };
  }
}
