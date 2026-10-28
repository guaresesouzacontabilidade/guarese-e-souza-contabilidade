import { detectarFamilia, extensaoDe, type Familia } from "@/lib/arquivos/tipos";

/**
 * Comprovantes dos recebimentos do hotel (foto do PIX, do comprovante do
 * cartão ou da transferência, ou o PDF): formatos aceitos, limite e a
 * conferência do tipo real do arquivo pelos primeiros bytes.
 */

export const LIMITE_COMPROVANTE = 10 * 1024 * 1024;
export const MAX_COMPROVANTES = 5;

const FAMILIA_DO_MIME: Record<string, Familia> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

export const MIMES_COMPROVANTE = new Set(Object.keys(FAMILIA_DO_MIME));

/** Tipo do arquivo escolhido (alguns aparelhos mandam "image/jpg" ou o tipo vazio na foto HEIC). */
export function mimeDoComprovante(tipo: string, nome: string): string | null {
  const t = tipo.toLowerCase().trim();
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (MIMES_COMPROVANTE.has(t)) return t;
  const ext = extensaoDe(nome);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  if (ext === "pdf") return "application/pdf";
  return null;
}

/** O conteúdo do arquivo é mesmo do tipo informado? */
export function assinaturaConfere(mime: string, inicio: Uint8Array): boolean {
  const esperada = FAMILIA_DO_MIME[mime];
  return Boolean(esperada) && detectarFamilia(inicio) === esperada;
}

/** Fotos e PDF comuns abrem no navegador; HEIC é baixado. */
export function exibeNoNavegador(mime: string) {
  return mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}
