import { describe, expect, it } from "vitest";
import { dimensoesImagem, tipoImagem } from "@/lib/imagens";
import { LOGO_ESCRITORIO_PNG } from "@/lib/marca/logo-png";

describe("imagens das logos", () => {
  it("lê largura e altura de um PNG (a logo do escritório para as planilhas)", () => {
    const bytes = new Uint8Array(Buffer.from(LOGO_ESCRITORIO_PNG.split(",")[1], "base64"));
    expect(tipoImagem(bytes)).toBe("image/png");
    expect(dimensoesImagem(bytes)).toEqual({ largura: 640, altura: 143 });
  });

  it("lê largura e altura de um JPEG pelo quadro SOF", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, // início
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 (tamanho 4)
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x96, 0x01, 0xe0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // SOF0: 150 × 480
    ]);
    expect(tipoImagem(jpeg)).toBe("image/jpeg");
    expect(dimensoesImagem(jpeg)).toEqual({ largura: 480, altura: 150 });
  });

  it("recusa o que não é PNG nem JPEG", () => {
    expect(dimensoesImagem(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
  });
});
