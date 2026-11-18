import { describe, expect, it } from "vitest";
import {
  digitoEan13Valido,
  lerEtiquetaBalanca,
  lerQuadroToledo,
  lerTextoContinuo,
  mesmoCodigo,
  pesoLiquido,
  pesoPeloValor,
} from "@/lib/gestao/balanca";

const quadro = (corpo: string) => `\u0002${corpo}\u0003`;

/** Monta um EAN-13 com o dígito verificador certo (para os testes). */
function ean13(doze: string) {
  const soma = [...doze].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return `${doze}${(10 - (soma % 10)) % 10}`;
}

describe("balança no caixa", () => {
  it("lê o peso do protocolo Toledo (gramas ou com vírgula)", () => {
    expect(lerQuadroToledo(quadro("00452")).pesoKg?.toFixed(3)).toBe("0.452");
    expect(lerQuadroToledo(quadro("01250")).pesoKg?.toFixed(3)).toBe("1.250");
    expect(lerQuadroToledo(quadro("0.452")).pesoKg?.toFixed(3)).toBe("0.452");
    expect(lerQuadroToledo(quadro(" 1,075")).pesoKg?.toFixed(3)).toBe("1.075");
    expect(lerQuadroToledo(new TextEncoder().encode(quadro("00890"))).estado).toBe("estavel");
    // Lixo antes e dois quadros seguidos: vale o último
    expect(lerQuadroToledo(`xx${quadro("00100")}${quadro("00333")}`).pesoKg?.toFixed(3)).toBe("0.333");
  });

  it("reconhece peso instável, negativo, acima do limite e resposta inválida", () => {
    expect(lerQuadroToledo(quadro("IIIII")).estado).toBe("instavel");
    expect(lerQuadroToledo(quadro("NNNNN")).estado).toBe("negativo");
    expect(lerQuadroToledo(quadro("SSSSS")).estado).toBe("sobrecarga");
    expect(lerQuadroToledo("00452").estado).toBe("invalido");
    expect(lerQuadroToledo(quadro("abc")).estado).toBe("invalido");
  });

  it("lê balança que envia o peso sem parar, como texto", () => {
    expect(lerTextoContinuo("PESO L: 0,452 kg\r\nPESO L: 0,455 kg\r\n").pesoKg?.toFixed(3)).toBe("0.455");
    expect(lerTextoContinuo("ST,GS,+  0.612kg\r\n").pesoKg?.toFixed(3)).toBe("0.612");
    expect(lerTextoContinuo("PESO INSTAVEL\r\n").estado).toBe("instavel");
    expect(lerTextoContinuo("\r\n").estado).toBe("invalido");
  });

  it("desconta o peso do prato sem ficar negativo", () => {
    expect(pesoLiquido("0.802", "0.350").toFixed(3)).toBe("0.452");
    expect(pesoLiquido("0.300", "0.350").toFixed(3)).toBe("0.000");
    expect(pesoLiquido("0.452", null).toFixed(3)).toBe("0.452");
  });

  it("lê a etiqueta da balança (preço total ou peso)", () => {
    const comPreco = ean13("200120002345"); // produto 12, R$ 23,45
    expect(digitoEan13Valido(comPreco)).toBe(true);
    expect(lerEtiquetaBalanca(comPreco, { formato: "preco", digitosCodigo: 4 })).toMatchObject({ codigoProduto: "12" });
    expect(lerEtiquetaBalanca(comPreco, { formato: "preco", digitosCodigo: 4 })?.valor?.toFixed(2)).toBe("23.45");
    const comPeso = ean13("200034000452"); // produto 34 (5 dígitos), 0,452 kg
    const e = lerEtiquetaBalanca(comPeso, { formato: "peso", digitosCodigo: 5 });
    expect(e?.codigoProduto).toBe("34");
    expect(e?.pesoKg?.toFixed(3)).toBe("0.452");
    // Dígito verificador errado, não começa com 2 ou tamanho errado: não é etiqueta
    expect(lerEtiquetaBalanca(`${comPreco.slice(0, 12)}${(Number(comPreco[12]) + 1) % 10}`, { formato: "preco", digitosCodigo: 4 })).toBeNull();
    expect(lerEtiquetaBalanca(ean13("789012345678"), { formato: "preco", digitosCodigo: 4 })).toBeNull();
    expect(lerEtiquetaBalanca("2001", { formato: "preco", digitosCodigo: 4 })).toBeNull();
    expect(mesmoCodigo("0012", "12")).toBe(true);
    expect(mesmoCodigo("120", "12")).toBe(false);
  });

  it("etiqueta com preço: peso e desconto de centavos para o total bater", () => {
    const r = pesoPeloValor("23.45", "59.90")!;
    expect(r.pesoKg.toFixed(3)).toBe("0.392");
    // 0,392 × 59,90 = 23,48 → desconto de 0,03 para dar os 23,45 da etiqueta
    expect(r.pesoKg.times("59.90").toDecimalPlaces(2).minus(r.desconto).toFixed(2)).toBe("23.45");
    expect(pesoPeloValor("10", "0")).toBeNull();
  });
});
