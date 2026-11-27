import { describe, expect, it } from "vitest";
import { inteiroPorExtenso, valorPorExtenso } from "@/lib/declaracoes/extenso";

describe("valor por extenso", () => {
  it("escreve números inteiros", () => {
    expect(inteiroPorExtenso(0)).toBe("zero");
    expect(inteiroPorExtenso(1)).toBe("um");
    expect(inteiroPorExtenso(15)).toBe("quinze");
    expect(inteiroPorExtenso(21)).toBe("vinte e um");
    expect(inteiroPorExtenso(100)).toBe("cem");
    expect(inteiroPorExtenso(101)).toBe("cento e um");
    expect(inteiroPorExtenso(110)).toBe("cento e dez");
    expect(inteiroPorExtenso(999)).toBe("novecentos e noventa e nove");
    expect(inteiroPorExtenso(1000)).toBe("mil");
    expect(inteiroPorExtenso(1001)).toBe("mil e um");
    expect(inteiroPorExtenso(1100)).toBe("mil e cem");
    expect(inteiroPorExtenso(1230)).toBe("mil, duzentos e trinta");
    expect(inteiroPorExtenso(2015)).toBe("dois mil e quinze");
    expect(inteiroPorExtenso(32450)).toBe("trinta e dois mil, quatrocentos e cinquenta");
    expect(inteiroPorExtenso(100000)).toBe("cem mil");
    expect(inteiroPorExtenso(1000000)).toBe("um milhão");
    expect(inteiroPorExtenso(1500000)).toBe("um milhão e quinhentos mil");
    expect(inteiroPorExtenso(2345678)).toBe("dois milhões, trezentos e quarenta e cinco mil, seiscentos e setenta e oito");
    expect(inteiroPorExtenso(1000000000)).toBe("um bilhão");
  });

  it("escreve valores em reais e centavos", () => {
    expect(valorPorExtenso(0)).toBe("zero real");
    expect(valorPorExtenso("0.5")).toBe("cinquenta centavos");
    expect(valorPorExtenso("0.01")).toBe("um centavo");
    expect(valorPorExtenso(1)).toBe("um real");
    expect(valorPorExtenso("1.01")).toBe("um real e um centavo");
    expect(valorPorExtenso(2)).toBe("dois reais");
    expect(valorPorExtenso("1230.45")).toBe("mil, duzentos e trinta reais e quarenta e cinco centavos");
    expect(valorPorExtenso("32450.30")).toBe("trinta e dois mil, quatrocentos e cinquenta reais e trinta centavos");
    expect(valorPorExtenso(1000000)).toBe("um milhão de reais");
    expect(valorPorExtenso("2000000.50")).toBe("dois milhões de reais e cinquenta centavos");
    expect(valorPorExtenso(1500000)).toBe("um milhão e quinhentos mil reais");
    expect(() => valorPorExtenso(-1)).toThrow();
  });
});
