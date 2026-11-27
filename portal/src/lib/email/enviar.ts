import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { envServidor } from "@/lib/env-servidor";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { formatarCep, formatarCnpj } from "@/lib/formatos";
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

/** Rodapé dos e-mails com os dados do escritório (Configurações do escritório). */
async function dadosEscritorio(): Promise<DadosModeloEmail["escritorio"]> {
  try {
    const e = await obterEscritorioPublico();
    const endereco = [
      [e.logradouro, e.numero ? `nº ${e.numero}` : null].filter(Boolean).join(", "),
      e.bairro,
      [e.cidade, e.uf].filter(Boolean).join(" – "),
      e.cep ? `CEP ${formatarCep(e.cep)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return { nome: e.nome_fantasia, razao: e.razao_social, cnpj: e.cnpj ? formatarCnpj(e.cnpj) : "", endereco };
  } catch {
    return undefined;
  }
}

export function emailConfigurado() {
  return envServidor.smtp() !== null;
}

/**
 * Envia e-mail pelo SMTP configurado. Quando o SMTP não está configurado,
 * NÃO simula o envio: retorna { enviado: false, motivo: "nao_configurado" }.
 */
export interface AnexoEmail {
  nome: string;
  conteudo: Buffer;
  tipo: string;
  /** Imagem mostrada dentro do e-mail (cid:...), em vez de anexo solto. */
  cid?: string;
}

export async function enviarEmail(
  para: string,
  assunto: string,
  conteudo: DadosModeloEmail,
  anexos: AnexoEmail[] = [],
  opcoes: { responderPara?: string } = {},
): Promise<ResultadoEnvio> {
  const t = obterTransporte();
  if (!t) return { enviado: false, motivo: "nao_configurado" };
  const { html, texto } = modeloEmail(conteudo.remetente || conteudo.escritorio ? conteudo : { ...conteudo, escritorio: await dadosEscritorio() });
  try {
    const info = await t.transporte.sendMail({
      from: t.remetente,
      to: para,
      subject: assunto,
      replyTo: opcoes.responderPara,
      html,
      text: texto,
      attachments: anexos.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.tipo, ...(a.cid ? { cid: a.cid } : {}) })),
    });
    return { enviado: true, id: info.messageId ?? null };
  } catch (e) {
    return { enviado: false, motivo: "falhou", erro: e instanceof Error ? e.message : String(e) };
  }
}
