import { describe, expect, it } from "vitest";
import { dividir, gerarParcelas, mudarValorParcela, somaParcelas, somarMeses, validarParcelas } from "@/lib/financeiro/parcelas";

describe("parcelas do financeiro", () => {
  it("divide o total com os centavos de diferença na última", () => {
    expect(dividir("100,00", 3)).toEqual(["33,33", "33,33", "33,34"]);
    expect(dividir("1.200,00", 4)).toEqual(["300,00", "300,00", "300,00", "300,00"]);
  });

  it("soma meses respeitando o fim do mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-11-15", 2)).toBe("2027-01-15");
  });

  it("gera parcelas mensais, quinzenais e semanais", () => {
    expect(gerarParcelas("300,00", 3, "2026-12-10").map((p) => p.vencimento)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10"]);
    expect(gerarParcelas("300,00", 3, "2026-12-10", "quinzenal").map((p) => p.vencimento)).toEqual(["2026-12-10", "2026-12-25", "2027-01-09"]);
    expect(gerarParcelas("300,00", 2, "2026-12-10", "semanal").map((p) => p.vencimento)).toEqual(["2026-12-10", "2026-12-17"]);
    expect(gerarParcelas("300,00", 3, "")).toEqual([]);
  });

  it("ao mudar uma parcela, a última fecha o total", () => {
    const p = gerarParcelas("1.000,00", 3, "2026-12-10");
    const nova = mudarValorParcela(p, 0, "500,00", "1.000,00");
    expect(nova.map((x) => x.valor)).toEqual(["500,00", "333,33", "166,67"]);
    expect(somaParcelas(nova).toFixed(2)).toBe("1000.00");
    // Mudar a última não mexe nas outras (a tela avisa a diferença)
    const ultima = mudarValorParcela(p, 2, "400,00", "1.000,00");
    expect(somaParcelas(ultima).toFixed(2)).toBe("1066.66");
  });

  it("confere as parcelas no servidor", () => {
    const ok = validarParcelas(JSON.stringify([{ vencimento: "2026-12-10", valor: "600,00" }, { vencimento: "2027-01-20", valor: "400,00" }]), "1000.00");
    expect(ok).toEqual({ ok: true, parcelas: [{ vencimento: "2026-12-10", valor: "600.00" }, { vencimento: "2027-01-20", valor: "400.00" }] });
    expect(validarParcelas(JSON.stringify([{ vencimento: "2026-12-10", valor: "600,00" }, { vencimento: "2027-01-20", valor: "300,00" }]), "1000.00")).toMatchObject({ ok: false, mensagem: expect.stringContaining("precisa ser igual") });
    expect(validarParcelas(JSON.stringify([{ vencimento: "2026-12-10", valor: "1000,00" }]), "1000.00")).toMatchObject({ ok: false });
    expect(validarParcelas(JSON.stringify([{ vencimento: "", valor: "500,00" }, { vencimento: "2027-01-20", valor: "500,00" }]), "1000.00")).toMatchObject({ ok: false, mensagem: "Parcela 1: informe o vencimento." });
    expect(validarParcelas(JSON.stringify([{ vencimento: "2026-12-10", valor: "0" }, { vencimento: "2027-01-20", valor: "1000,00" }]), "1000.00")).toMatchObject({ ok: false });
    expect(validarParcelas("nada", "1000.00")).toMatchObject({ ok: false });
  });
});
