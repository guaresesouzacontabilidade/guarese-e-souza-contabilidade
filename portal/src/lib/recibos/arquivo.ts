import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assinarPdf, ErroAssinatura, type Credencial } from "@/lib/assinatura/pdf";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { reciboParaPdf, type LinhaRecibo } from "./carregar";
import { numeroRecibo } from "./comum";
import { gerarPdfRecibo } from "./pdf";

const BUCKET = "recibos";

export interface CertificadoEscritorio {
  titular: string;
  documento: string;
  valido_ate: string;
}

/** Quem assina os recibos (sem a chave): null quando o certificado não foi cadastrado. */
export async function certificadoDoEscritorio(supabase: SupabaseClient<Database>): Promise<CertificadoEscritorio | null> {
  const { data } = await supabase.from("escritorio_certificado").select("titular, documento, valido_ate").maybeSingle();
  return data ?? null;
}

/** Nome do titular sem o documento do fim ("EMPRESA LTDA:62935399000150" → "EMPRESA LTDA"). */
export const nomeDoTitular = (titular: string) => titular.replace(/:[0-9A-Z]{11,14}$/i, "").trim();

/**
 * Gera o PDF do recibo e, com o certificado do escritório cadastrado e
 * válido, assina e guarda o arquivo assinado (os downloads seguintes entregam
 * esse mesmo arquivo). Sem certificado, devolve o PDF sem assinatura. Uma
 * falha na assinatura não impede o recibo: volta o PDF sem assinatura e o motivo.
 */
export async function gerarArquivoRecibo(
  supabase: SupabaseClient<Database>,
  linha: LinhaRecibo,
): Promise<{ pdf: Buffer; assinado: boolean; erro?: string }> {
  const semAssinatura = async (erro?: string) => ({ pdf: await gerarPdfRecibo(reciboParaPdf(linha)), assinado: false, erro });
  if (linha.situacao !== "emitido") return semAssinatura();
  const cert = await certificadoDoEscritorio(supabase);
  if (!cert) return semAssinatura();
  if (new Date(cert.valido_ate) <= new Date()) return semAssinatura("o certificado do escritório venceu");

  const admin = criarClienteAdmin();
  let credencial: Credencial;
  try {
    const { data: segredo } = await admin.from("escritorio_certificado_segredo").select("conteudo_cifrado").eq("id", 1).maybeSingle();
    if (!segredo) return semAssinatura("o certificado guardado não foi encontrado");
    credencial = JSON.parse(decifrar(segredo.conteudo_cifrado)) as Credencial;
  } catch (e) {
    return semAssinatura(e instanceof Error ? e.message : "não foi possível abrir o certificado guardado");
  }

  const data = new Date();
  const nome = nomeDoTitular(cert.titular);
  const dados = { ...reciboParaPdf(linha), assinatura: { titular: nome, documento: cert.documento, data } };
  let pdf: Buffer;
  try {
    pdf = assinarPdf(await gerarPdfRecibo(dados), credencial, {
      nome,
      motivo: `Recibo de honorários nº ${numeroRecibo(linha)}`,
      local: `${linha.cidade}${linha.uf ? `/${linha.uf}` : ""}`,
      contato: dados.emitente.email ?? "",
      data,
    });
  } catch (e) {
    return semAssinatura(e instanceof ErroAssinatura ? e.message : "a assinatura falhou");
  }

  const caminho = `${linha.ano}/${linha.id}${linha.arquivo_path ? `-${data.getTime()}` : ""}.pdf`;
  const { error: erroUp } = await admin.storage.from(BUCKET).upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
  if (erroUp) return semAssinatura("o arquivo assinado não foi guardado");
  const { error } = await supabase.rpc("recibo_registrar_assinatura", { p_recibo_id: linha.id, p_path: caminho, p_titular: nome, p_documento: cert.documento });
  if (error) {
    await admin.storage.from(BUCKET).remove([caminho]);
    return semAssinatura(error.message);
  }
  if (linha.arquivo_path) await admin.storage.from(BUCKET).remove([linha.arquivo_path]);
  return { pdf, assinado: true };
}

/** Arquivo assinado guardado (null quando o recibo não tem, ou foi cancelado). */
export async function arquivoAssinado(linha: LinhaRecibo): Promise<Buffer | null> {
  if (linha.situacao !== "emitido" || !linha.arquivo_path) return null;
  const { data } = await criarClienteAdmin().storage.from(BUCKET).download(linha.arquivo_path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}
