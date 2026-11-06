import "server-only";
import { envPublico } from "@/lib/env";

/** Fotos do site da loja: armazenamento público, na pasta da empresa e do produto. */
export const BUCKET_SITE = "loja-site";
export const LARGURAS = { p: 600, g: 1200 } as const;
export const FOTO_MAX_BYTES = 8 * 1024 * 1024;

/** Endereço-base da foto (o site acrescenta "-p.webp" ou "-g.webp"). */
export function urlFotoBase(caminho: string): string {
  return `${envPublico.supabaseUrl().replace(/\/$/, "")}/storage/v1/object/public/${BUCKET_SITE}/${caminho}`;
}

/** Formato real pelos primeiros bytes: JPEG, PNG ou WebP. */
export function formatoFoto(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Prepara a foto para o site: dois WebP (por padrão 600 e 1200 px de largura, sem
 * aumentar fotos pequenas), já leves para o celular. Devolve null quando o
 * arquivo não é uma imagem aceita.
 */
export async function prepararFoto(bytes: Uint8Array, larguras: { p: number; g: number } = LARGURAS): Promise<{ p: Buffer; g: Buffer } | null> {
  if (!formatoFoto(bytes) || bytes.length > FOTO_MAX_BYTES) return null;
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  let img: Awaited<ReturnType<typeof loadImage>>;
  try {
    img = await loadImage(Buffer.from(bytes));
  } catch {
    return null;
  }
  if (!img.width || !img.height || img.width * img.height > 60_000_000) return null;
  const gerar = async (largura: number) => {
    const w = Math.min(largura, img.width);
    const h = Math.round((img.height * w) / img.width);
    const c = createCanvas(w, h);
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    return c.encode("webp", 82);
  };
  return { p: await gerar(larguras.p), g: await gerar(larguras.g) };
}
