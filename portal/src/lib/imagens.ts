/** Formato real de uma imagem pelos primeiros bytes (não pela extensão): só PNG e JPEG. */
export function tipoImagem(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export const EXTENSAO_IMAGEM = { "image/png": "png", "image/jpeg": "jpg" } as const;
