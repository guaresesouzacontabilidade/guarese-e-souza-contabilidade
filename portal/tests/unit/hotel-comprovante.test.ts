import { describe, expect, it } from "vitest";
import { assinaturaConfere, exibeNoNavegador, mimeDoComprovante } from "@/lib/hotel/comprovante-arquivo";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)].slice(0, 16));
const texto = (t: string) => new TextEncoder().encode(t.padEnd(16, " "));

describe("comprovantes do hotel", () => {
  it("reconhece o tipo da foto ou do PDF, mesmo com o tipo vazio ou fora do padrão", () => {
    expect(mimeDoComprovante("image/jpeg", "pix.jpg")).toBe("image/jpeg");
    expect(mimeDoComprovante("image/jpg", "pix.jpg")).toBe("image/jpeg");
    expect(mimeDoComprovante("", "IMG_0001.HEIC")).toBe("image/heic");
    expect(mimeDoComprovante("", "comprovante.pdf")).toBe("application/pdf");
    expect(mimeDoComprovante("text/html", "pagina.html")).toBeNull();
    expect(mimeDoComprovante("", "planilha.xlsx")).toBeNull();
  });

  it("confere o conteúdo do arquivo pelos primeiros bytes", () => {
    expect(assinaturaConfere("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(assinaturaConfere("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(assinaturaConfere("application/pdf", texto("%PDF-1.7"))).toBe(true);
    expect(assinaturaConfere("image/heic", bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))).toBe(true);
    // Página da web com nome de foto, ou foto PNG dizendo ser PDF: recusado
    expect(assinaturaConfere("image/jpeg", texto("<html><body>"))).toBe(false);
    expect(assinaturaConfere("application/pdf", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(assinaturaConfere("text/html", texto("<html>"))).toBe(false);
  });

  it("abre no navegador só foto comum e PDF; HEIC é baixado", () => {
    expect(exibeNoNavegador("image/png")).toBe(true);
    expect(exibeNoNavegador("application/pdf")).toBe(true);
    expect(exibeNoNavegador("image/heic")).toBe(false);
  });
});
