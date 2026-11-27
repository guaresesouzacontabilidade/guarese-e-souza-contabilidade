import "server-only";
import { assinarPdf, ErroAssinatura, type Credencial } from "@/lib/assinatura/pdf";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";

/**
 * Assinatura digital de um PDF com o certificado A1 do escritório (o mesmo
 * dos recibos). Sem certificado (ou vencido), devolve o motivo e o PDF segue
 * sem assinatura — nada é simulado.
 */
export interface QuemAssina {
  titular: string;
  documento: string;
}

export async function certificadoValidoDoEscritorio(): Promise<{ quem: QuemAssina; credencial: Credencial } | { erro: string | null }> {
  const admin = criarClienteAdmin();
  const { data: cert } = await admin.from("escritorio_certificado").select("titular, documento, valido_ate").maybeSingle();
  if (!cert) return { erro: null };
  if (new Date(cert.valido_ate) <= new Date()) return { erro: "o certificado do escritório venceu" };
  try {
    const { data: segredo } = await admin.from("escritorio_certificado_segredo").select("conteudo_cifrado").eq("id", 1).maybeSingle();
    if (!segredo) return { erro: "o certificado guardado não foi encontrado" };
    const credencial = JSON.parse(decifrar(segredo.conteudo_cifrado)) as Credencial;
    return { quem: { titular: cert.titular.replace(/:[0-9A-Z]{11,14}$/i, "").trim(), documento: cert.documento }, credencial };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não foi possível abrir o certificado guardado" };
  }
}

/** Assina o PDF (PAdES AD-RB) ou devolve o original com o motivo. */
export function assinarComEscritorio(
  pdf: Buffer,
  cert: { quem: QuemAssina; credencial: Credencial },
  info: { motivo: string; local: string; contato: string; data: Date },
): { pdf: Buffer; assinado: true } | { pdf: Buffer; assinado: false; erro: string } {
  try {
    return { pdf: assinarPdf(pdf, cert.credencial, { nome: cert.quem.titular, ...info }), assinado: true };
  } catch (e) {
    return { pdf, assinado: false, erro: e instanceof ErroAssinatura ? e.message : "a assinatura falhou" };
  }
}
