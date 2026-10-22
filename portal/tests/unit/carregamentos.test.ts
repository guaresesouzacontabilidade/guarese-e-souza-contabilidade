import { describe, expect, it } from "vitest";
import { formatarKg, limparPlaca, mostrarPlaca, notaVale, placaValida, quantidadePelaPesagem, textoPesagem } from "@/lib/gestao/carregamentos";

describe("ordem de carregamento — peso da balança na unidade do produto", () => {
  it("KG fica igual ao peso líquido", () => {
    expect(quantidadePelaPesagem("36020", "KG", 1)?.toString()).toBe("36020");
    expect(quantidadePelaPesagem("36020.5", "kg", null)?.toString()).toBe("36020.5");
  });

  it("tonelada divide por mil", () => {
    expect(quantidadePelaPesagem("36020", "TON", null)?.toString()).toBe("36.02");
    expect(quantidadePelaPesagem("36020", "t", null)?.toString()).toBe("36.02");
  });

  it("saca usa o peso do cadastro (60 kg) e arredonda em 4 casas", () => {
    expect(quantidadePelaPesagem("36000", "SC", 60)?.toString()).toBe("600");
    expect(quantidadePelaPesagem("36020", "SC", 60)?.toString()).toBe("600.3333");
    expect(quantidadePelaPesagem("36050", "SC", 60)?.toString()).toBe("600.8333");
  });

  it("sem como converter, devolve null", () => {
    expect(quantidadePelaPesagem("36020", "SC", null)).toBeNull();
    expect(quantidadePelaPesagem("0", "KG", 1)).toBeNull();
  });
});

describe("ordem de carregamento — placas", () => {
  it("limpa traço, espaço e minúsculas", () => {
    expect(limparPlaca("abc-1d23")).toBe("ABC1D23");
    expect(limparPlaca(" qbc 1234 ")).toBe("QBC1234");
    expect(limparPlaca("")).toBeNull();
  });

  it("aceita a placa antiga e a do Mercosul", () => {
    expect(placaValida("ABC1234")).toBe(true);
    expect(placaValida("ABC1D23")).toBe(true);
    expect(placaValida("AB12345")).toBe(false);
    expect(placaValida("ABC12D3")).toBe(false);
  });

  it("mostra a antiga com traço e a do Mercosul sem", () => {
    expect(mostrarPlaca("ABC1234")).toBe("ABC-1234");
    expect(mostrarPlaca("ABC1D23")).toBe("ABC1D23");
    expect(mostrarPlaca(null)).toBe("—");
  });
});

describe("ordem de carregamento — NF-e", () => {
  it("nota cancelada, descartada ou recusada não segura a ordem", () => {
    expect(notaVale("autorizada")).toBe(true);
    expect(notaVale("na_fila")).toBe(true);
    expect(notaVale("rejeitada")).toBe(false);
    expect(notaVale("cancelada")).toBe(false);
    expect(notaVale(null)).toBe(false);
  });

  it("texto da pesagem para as informações complementares", () => {
    const t = textoPesagem({
      numero: 15,
      peso_bruto_kg: 51020,
      tara_kg: 15000,
      peso_liquido_kg: 36020,
      umidade: 13.5,
      impureza: 0.8,
      ticket_balanca: "4512",
      contrato: "CT-2026/15",
      motorista_nome: "João Motorista",
    });
    expect(t).toBe(
      "Ordem de carregamento nº 15. Contrato CT-2026/15. Pesagem: bruto 51.020 kg, tara 15.000 kg, líquido 36.020 kg (ticket 4512). " +
        "Classificação na origem: umidade 13,5%, impureza 0,8%. Motorista: João Motorista.",
    );
  });

  it("sem pesagem, só o número da ordem", () => {
    expect(
      textoPesagem({
        numero: 3,
        peso_bruto_kg: null,
        tara_kg: null,
        peso_liquido_kg: null,
        umidade: null,
        impureza: null,
        ticket_balanca: null,
        contrato: null,
        motorista_nome: null,
      }),
    ).toBe("Ordem de carregamento nº 3.");
    expect(formatarKg(1234.5)).toBe("1.234,5 kg");
  });
});
