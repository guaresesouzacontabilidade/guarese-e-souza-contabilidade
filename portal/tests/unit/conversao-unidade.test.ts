import { describe, expect, it } from "vitest";
import { sugestaoCompra } from "@/lib/gestao/analise-estoque";
import { classeUnidade, emUnidadesDeCompra, fatorDaNota, nomeUnidade, rendimentoSugerido, resumoConversao, temConversao } from "@/lib/gestao/conversao";

const vigota = { unidade: "M", unidade_compra: "PC", fator_compra: "3" };

describe("conversão de unidade entre compra e venda", () => {
  it("reconhece a mesma unidade escrita de jeitos diferentes (igual ao banco)", () => {
    expect(["Pç", "und", "PEÇA", "UN", "pcs"].map(classeUnidade)).toEqual(["UN", "UN", "UN", "UN", "UN"]);
    expect(["mts", "MT", "Metro", "ML"].map(classeUnidade)).toEqual(["M", "M", "M", "M"]);
    expect([classeUnidade("M³"), classeUnidade("m2"), classeUnidade("CXA"), classeUnidade("FD"), classeUnidade("")]).toEqual(["M3", "M2", "CX", "FD", null]);
  });

  it("nota na unidade de compra usa o rendimento; na de venda, 1; em outra, pede conferência", () => {
    expect(fatorDaNota(vigota, "PÇ")?.toString()).toBe("3");
    expect(fatorDaNota(vigota, "UN")?.toString()).toBe("3");
    expect(fatorDaNota(vigota, "MTS")?.toString()).toBe("1");
    expect(fatorDaNota(vigota, "CX")).toBeNull();
    expect(fatorDaNota({ unidade: "UN" }, "CX")?.toString()).toBe("1");
  });

  it("sem conversão ou com a mesma unidade, não converte", () => {
    expect(temConversao({ unidade: "M" })).toBe(false);
    expect(temConversao({ unidade: "M", unidade_compra: "M", fator_compra: 3 })).toBe(false);
    expect(temConversao(vigota)).toBe(true);
  });

  it("resume a conversão como na tela", () => {
    expect(resumoConversao("PC", "3", "M")).toEqual({ frase: "1 Peça equivale a 3 Metros", exemplo: "10 Peças = 30 Metros" });
    expect(resumoConversao("UN", "1", "M")).toEqual({ frase: "1 Unidade equivale a 1 Metro", exemplo: "10 Unidades = 10 Metros" });
    expect(resumoConversao("CX", "12", "UN").frase).toBe("1 Caixa equivale a 12 Unidades");
    expect(nomeUnidade("XYZ")).toBe("XYZ");
  });

  it("sugere o rendimento pelas medidas da peça", () => {
    expect(rendimentoSugerido({ unidade: "M", espessura_cm: null, largura_cm: null, comprimento_m: "3" }, "PC")?.toString()).toBe("3");
    expect(rendimentoSugerido({ unidade: "M3", espessura_cm: "8", largura_cm: "8", comprimento_m: "3" }, "UN")?.toString()).toBe("0.0192");
    expect(rendimentoSugerido({ unidade: "M", espessura_cm: null, largura_cm: null, comprimento_m: "3" }, "CX")).toBeNull();
    expect(rendimentoSugerido({ unidade: "UN", espessura_cm: null, largura_cm: null, comprimento_m: null }, "CX")).toBeNull();
  });

  it("mostra a compra em peças, arredondada para cima", () => {
    expect(emUnidadesDeCompra("14", vigota)?.toString()).toBe("5");
    expect(emUnidadesDeCompra("15", vigota)?.toString()).toBe("5");
    expect(emUnidadesDeCompra("15", { unidade: "M" })).toBeNull();
  });

  it("sugestão de compra em peças inteiras (o estoque continua em metros)", () => {
    const produto = {
      id: "v1", descricao: "Vigota", codigo: "V", grupo: null, unidade: "M", estoque_atual: "2", estoque_minimo: null, custo_medio: "10",
      preco_custo: "10", valor_unitario: "18", controla_estoque: true, espessura_cm: null, largura_cm: null, comprimento_m: "3",
      unidade_compra: "PC", fator_compra: "3",
    };
    const vendas = new Map([["v1", { produto_id: "v1", quantidade: "60", faturamento: "1080", custo: "600", vendas: 10, ultima_venda: "2026-11-20" }]]);
    const [linha] = sugestaoCompra([produto], vendas, 30, 30);
    // Precisa de 58 m (60 para 30 dias − 2): 19,3 peças → 20 peças = 60 m
    expect(linha.comprarNaCompra?.toString()).toBe("20");
    expect(linha.comprar.toString()).toBe("60");
    expect(linha.valorCompra.toString()).toBe("600");
  });
});
