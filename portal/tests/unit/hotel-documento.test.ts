import { describe, expect, it } from "vitest";
import { gerarDocumentoHotel, luminancia, modeloValido, paletaDe, type IdentidadeHotel } from "@/lib/hotel/documento";

const hotel: IdentidadeHotel = {
  nome: "Hotel Teste",
  razao: "HOTEL TESTE LTDA",
  documento: "12.345.678/0001-95",
  endereco: "Rua A, 10 — Centro — Porto Nacional/TO",
  contatos: ["Tel. (63) 3363-0000", "WhatsApp (63) 99999-0000"],
  cadastur: "12.345678.10.0001-1",
  logo: null,
  modelo: "classico",
  cor: "#1f3b57",
};

describe("documentos do hotel", () => {
  it("aceita só os três modelos", () => {
    expect(modeloValido("classico")).toBe(true);
    expect(modeloValido("faixa")).toBe(true);
    expect(modeloValido("economico")).toBe(true);
    expect(modeloValido("neon")).toBe(false);
    expect(modeloValido("toString")).toBe(false);
    expect(modeloValido(null)).toBe(false);
  });

  it("escolhe o texto com contraste sobre a cor do hotel", () => {
    expect(luminancia("#000000")).toBe(0);
    expect(luminancia("#ffffff")).toBe(1);
    const escura = paletaDe("faixa", "#1f3b57");
    expect(escura.sobreDestaque).toBe("#ffffff");
    expect(escura.titulo).toBe("#1f3b57");
    // Amarelo claro: texto escuro na faixa e título escurecido no papel branco
    const clara = paletaDe("faixa", "#f2c94c");
    expect(clara.sobreDestaque).toBe("#1a1a1a");
    expect(luminancia(clara.titulo)).toBeLessThan(luminancia("#f2c94c") / 2);
  });

  it("o modelo econômico sai em preto e branco", () => {
    const p = paletaDe("economico", "#1f6f4a");
    expect([p.destaque, p.titulo, p.alerta, p.linha, p.zebra].every((c) => /^#([0-9a-f]{2})\1\1$/.test(c))).toBe(true);
  });

  it("gera o PDF de cada modelo com o nome do hotel e sem a marca do escritório", async () => {
    for (const modelo of ["classico", "faixa", "economico"] as const) {
      const pdf = await gerarDocumentoHotel({ ...hotel, modelo }, { titulo: "Extrato da conta do hospede", subtitulo: "Reserva 1", notaFinal: "Obrigado" }, [{ text: "Conteudo" }]);
      const texto = pdf.toString("latin1");
      expect(texto.startsWith("%PDF")).toBe(true);
      expect(texto).toContain("(Hotel Teste)");
      expect(texto).not.toMatch(/Guarese/i);
    }
  });
});
