import { describe, expect, it } from "vitest";
import { formatarQuantidade, modoMedida, parcelasDoPrazo, quantidadePorPecas, secaoPeca, un } from "@/lib/gestao/rotulos";

const caibro = { unidade: "M3", espessura_cm: "5", largura_cm: "6", comprimento_m: "3" };
const ripa = { unidade: "M", espessura_cm: null, largura_cm: null, comprimento_m: "3" };
const mourao = { unidade: "PC", espessura_cm: null, largura_cm: null };

describe("gestão da loja — medidas da madeira", () => {
  it("escolhe como a quantidade é informada", () => {
    expect(modoMedida(caibro)).toBe("cubagem");
    expect(modoMedida(ripa)).toBe("metro");
    expect(modoMedida(mourao)).toBe("direto");
    // m³ sem a seção da peça (ex.: lenha) é informado direto
    expect(modoMedida({ unidade: "M3", espessura_cm: null, largura_cm: null })).toBe("direto");
  });

  it("calcula a cubagem pelas peças (mesma conta do banco)", () => {
    expect(quantidadePorPecas(caibro, 10, "3")?.toString()).toBe("0.09");
    expect(quantidadePorPecas(caibro, 5, null)?.toString()).toBe("0.045"); // usa o comprimento padrão
    expect(quantidadePorPecas({ unidade: "M3", espessura_cm: "6", largura_cm: "12" }, 40, "4")?.toString()).toBe("1.152");
    expect(quantidadePorPecas({ unidade: "M3", espessura_cm: "2.5", largura_cm: "30" }, 20, "3")?.toString()).toBe("0.45");
    // arredonda em 4 casas
    expect(quantidadePorPecas({ unidade: "M3", espessura_cm: "2.7", largura_cm: "7.3" }, 3, "2.15")?.toString()).toBe("0.0127");
  });

  it("calcula o metro linear e a quantidade direta", () => {
    expect(quantidadePorPecas(ripa, 33, "3")?.toString()).toBe("99");
    expect(quantidadePorPecas(mourao, 30, null)?.toString()).toBe("30");
  });

  it("recusa peças ou comprimento inválidos", () => {
    expect(quantidadePorPecas(caibro, 0, "3")).toBeNull();
    expect(quantidadePorPecas(caibro, 2, "0")).toBeNull();
    expect(quantidadePorPecas({ unidade: "M3", espessura_cm: "5", largura_cm: "6" }, 2, null)).toBeNull();
  });

  it("escreve quantidades, unidades e a seção da peça", () => {
    expect(formatarQuantidade("0.2160")).toBe("0,216");
    expect(formatarQuantidade("1500")).toBe("1.500");
    expect(formatarQuantidade(null)).toBe("—");
    expect(un("M3")).toBe("m³");
    expect(un("M")).toBe("m");
    expect(un("PC")).toBe("PC");
    expect(secaoPeca(caibro)).toBe("5 × 6 cm");
    expect(secaoPeca({ unidade: "M3", espessura_cm: "2.5", largura_cm: "20" })).toBe("2,5 × 20 cm");
  });
});

describe("gestão da loja — parcelas a prazo", () => {
  it("divide o valor e a última parcela leva os centavos", () => {
    const p = parcelasDoPrazo("100", 3, "2026-11-21");
    expect(p.map((x) => x.valor.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    expect(p.map((x) => x.vencimento)).toEqual(["2026-11-21", "2026-12-21", "2027-01-20"]);
  });

  it("respeita o intervalo entre as parcelas", () => {
    const p = parcelasDoPrazo("2799.60", 2, "2026-11-21", 15);
    expect(p.map((x) => x.valor.toFixed(2))).toEqual(["1399.80", "1399.80"]);
    expect(p[1].vencimento).toBe("2026-12-06");
  });
});
