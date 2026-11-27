/** Formato real de uma imagem pelos primeiros bytes (não pela extensão): só PNG e JPEG. */
export function tipoImagem(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export const EXTENSAO_IMAGEM = { "image/png": "png", "image/jpeg": "jpg" } as const;

/** Largura e altura (pixels) de um PNG ou JPEG, lidas do próprio arquivo. */
export function dimensoesImagem(bytes: Uint8Array): { largura: number; altura: number } | null {
  const tipo = tipoImagem(bytes);
  if (tipo === "image/png" && bytes.length >= 24) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { largura: v.getUint32(16), altura: v.getUint32(20) };
  }
  if (tipo === "image/jpeg") {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marcador = bytes[i + 1];
      const tamanho = v.getUint16(i + 2);
      // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC)
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        return { altura: v.getUint16(i + 5), largura: v.getUint16(i + 7) };
      }
      i += 2 + tamanho;
    }
  }
  return null;
}
