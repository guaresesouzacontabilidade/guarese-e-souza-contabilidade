import { describe, expect, it } from "vitest";
import { mesesDoLote, nomeArquivoLote, tiposValidos } from "@/lib/lotes-xml/rotulos";

describe("XML em lote — nomes e opções", () => {
  it("nomeia o arquivo pelo mês e pela empresa, sem acentos", () => {
    expect(nomeArquivoLote("Padaria Pão Dourado (DEMO)", "2026-09-01", 1, 1)).toBe("xml-2026-09-padaria-pao-dourado-demo.zip");
    expect(nomeArquivoLote("Açougue São José", "2026-09-01", 2, 3)).toBe("xml-2026-09-acougue-sao-jose-parte-2-de-3.zip");
    expect(nomeArquivoLote("***", "2026-09-01", 1, 1)).toBe("xml-2026-09-empresa.zip");
  });

  it("oferece 5 anos de meses, com o mês anterior como padrão", () => {
    const { meses, padrao } = mesesDoLote("2026-10-01");
    expect(meses).toHaveLength(60);
    expect(meses[0]).toEqual({ valor: "2026-10", rotulo: "Outubro de 2026" });
    expect(meses.at(-1)?.valor).toBe("2021-11");
    expect(padrao).toBe("2026-09");
    expect(mesesDoLote("2026-01-01").padrao).toBe("2025-12");
  });

  it("aceita só os tipos conhecidos, na ordem padrão", () => {
    expect(tiposValidos(["eventos", "nfe_saida", "boleto", "nfe_entrada"])).toEqual(["nfe_entrada", "nfe_saida", "eventos"]);
    expect(tiposValidos([])).toEqual([]);
  });
});
