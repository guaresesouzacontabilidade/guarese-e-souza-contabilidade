import { describe, expect, it } from "vitest";
import { mesesDoPeriodo, sugerirValores, totais, ultimos12Meses } from "@/lib/declaracoes/faturamento";
import { codigoDeclaracao } from "@/lib/declaracoes/codigo";

describe("declaração de faturamento", () => {
  it("usa os 12 meses fechados antes do mês atual", () => {
    expect(ultimos12Meses("2026-10-01")).toEqual({ inicio: "2025-10-01", fim: "2026-09-01" });
    expect(ultimos12Meses("2026-01-01")).toEqual({ inicio: "2025-01-01", fim: "2025-12-01" });
    expect(mesesDoPeriodo("2025-10-01", "2026-09-01")).toHaveLength(12);
    expect(mesesDoPeriodo("2025-11-01", "2026-01-01")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01"]);
  });

  it("sugere a receita informada nos Cálculos ou o das notas (vendas + serviços − devoluções)", () => {
    const [informado, notas, semNotas, devolucaoMaior] = sugerirValores([
      { competencia: "2026-07-01", vendas: 999, servicos_nfe: 0, servicos: 0, devolucoes: 0, notas_saida: 3, informado: "5000.50" },
      { competencia: "2026-08-01", vendas: "1200.10", servicos_nfe: 100, servicos: "300.00", devolucoes: "50.10", notas_saida: 7, informado: null },
      { competencia: "2026-09-01", vendas: 0, servicos_nfe: 0, servicos: 0, devolucoes: 0, notas_saida: 0, informado: null },
      { competencia: "2026-10-01", vendas: 10, servicos_nfe: 0, servicos: 0, devolucoes: 50, notas_saida: 1, informado: null },
    ]);
    expect(informado).toMatchObject({ valor: "5000.50", origem: "informado" });
    expect(notas).toMatchObject({ valor: "1550.00", origem: "notas" });
    expect(notas.detalhe).toContain("7 notas");
    expect(notas.detalhe).toContain("devoluções");
    expect(semNotas).toMatchObject({ valor: "0.00", detalhe: "sem notas de saída no portal" });
    expect(devolucaoMaior.valor).toBe("0.00");
  });

  it("soma o total e a média sem erro de arredondamento", () => {
    const { total, media } = totais(["0.10", "0.20", "1000", 2500.35]);
    expect(total.toFixed(2)).toBe("3500.65");
    expect(media.toFixed(2)).toBe("875.16");
    expect(totais([]).total.toFixed(2)).toBe("0.00");
  });

  it("gera um código curto de conferência", () => {
    expect(codigoDeclaracao("3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e")).toBe("3F2A-9C1E-7B4D");
  });
});
