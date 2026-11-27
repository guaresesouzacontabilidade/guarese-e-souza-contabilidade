import "server-only";

/**
 * QR code do Pix, desenhado no servidor com o codificador que já vem no
 * pdfmake (sem biblioteca nova): SVG para as telas e PNG para o e-mail.
 */

interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
interface CodificadorQr {
  measure(no: { qr: string; eccLevel?: string; foreground?: string; background?: string }): { _canvas: Retangulo[]; _width: number };
}

let codificador: CodificadorQr | null = null;

async function carregar(): Promise<CodificadorQr> {
  if (!codificador) {
    const mod = (await import("pdfmake/js/qrEnc.js")) as unknown as { default?: CodificadorQr } & CodificadorQr;
    codificador = mod.default ?? mod;
  }
  return codificador;
}

/** Matriz de módulos (true = escuro). */
export async function matrizQr(texto: string): Promise<boolean[][]> {
  const q = await carregar();
  const no = q.measure({ qr: texto, eccLevel: "M", foreground: "#000000", background: "#ffffff" });
  const tamanhoModulo = 5;
  const n = Math.round(no._width / tamanhoModulo);
  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  for (const r of no._canvas) {
    if (r.color !== "#000000") continue;
    m[Math.round(r.y / tamanhoModulo)][Math.round(r.x / tamanhoModulo)] = true;
  }
  return m;
}

/** SVG com margem de 4 módulos (exigida pelos leitores). */
export async function qrSvg(texto: string, titulo = "QR code do Pix") {
  const m = await matrizQr(texto);
  const n = m.length;
  const lado = n + 8;
  let caminho = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) caminho += `M${x + 4} ${y + 4}h1v1h-1z`;
  const esc = titulo.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" role="img" aria-label="${esc}" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}

/** PNG (para anexar ao e-mail). */
export async function qrPng(texto: string, pixels = 420): Promise<Buffer> {
  const m = await matrizQr(texto);
  const n = m.length + 8;
  const escala = Math.max(2, Math.floor(pixels / n));
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(n * escala, n * escala);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, n * escala, n * escala);
  ctx.fillStyle = "#000000";
  m.forEach((linha, y) => linha.forEach((escuro, x) => escuro && ctx.fillRect((x + 4) * escala, (y + 4) * escala, escala, escala)));
  return canvas.toBuffer("image/png");
}
