import { describe, expect, it } from "vitest";
import { decodificarLinhaDigitavel, extrairCampos } from "@/lib/ocr/campos";

describe("extração de campos de comprovantes", () => {
  it("lê comprovante de PIX", () => {
    const texto = `Comprovante de transferência PIX
Valor: R$ 1.500,00
Data da transação: 30/09/2026 10:15
Destino: CLIENTE X LTDA CNPJ 98.765.432/0001-98
ID da transação: E00000000202609301015abcdeFGHIJ1`;
    const { campos, competenciaSugerida } = extrairCampos(texto);
    const v = (c: string) => campos.find((x) => x.campo === c);
    expect(v("valor")?.valor).toBe("1500.00");
    expect(v("valor")?.confianca).toBe("alta");
    expect(v("data")?.valor).toBe("2026-09-30");
    expect(v("cnpj")?.valor).toBe("98765432000198");
    expect(v("id_transacao_pix")?.valor).toBe("E00000000202609301015abcdeFGHIJ1");
    expect(competenciaSugerida).toBe("2026-09-01");
  });
  it("marca baixa confiança quando há várias possibilidades e palavras com OCR ruim", () => {
    const texto = "R$ 10,00 ... R$ 25,30 ... 01/09/2026 e 05/09/2026";
    const { campos } = extrairCampos(texto, [{ texto: "25,30", confianca: 40 }]);
    expect(campos.find((c) => c.campo === "valor")?.confianca).toBe("baixa");
    expect(campos.find((c) => c.campo === "data")?.confianca).toBe("baixa");
  });
  it("decodifica a linha digitável do boleto (valor e vencimento)", () => {
    // fator 1000 após o reinício de 22/02/2025 → 22/02/2025
    const r = decodificarLinhaDigitavel("00190000090000000000000000000000110000000012345");
    expect(r?.valor).toBe("123.45");
    expect(r?.vencimento).toBe("2025-02-22");
  });
});
