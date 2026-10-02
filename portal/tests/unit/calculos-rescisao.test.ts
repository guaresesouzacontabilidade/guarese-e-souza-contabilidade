import { describe, expect, it } from "vitest";
import { avosEntre, diasAvisoProporcional, simularRescisao, type EntradaRescisao } from "@/lib/calculos/rescisao";

const base: EntradaRescisao = {
  salario: 3000,
  admissao: "2023-03-10",
  desligamento: "2026-09-20",
  tipo: "sem_justa_causa",
  aviso: "indenizado",
  feriasVencidas: 0,
  saldoFgts: 9000,
  tipoFolha: "simples",
};

const verba = (r: ReturnType<typeof simularRescisao>, chave: string) => r.proventos.find((v) => v.chave === chave)?.valor.toFixed(2);

describe("rescisão", () => {
  it("aviso proporcional: 30 dias + 3 por ano completo, até 90", () => {
    expect(diasAvisoProporcional("2023-03-10", "2026-09-20")).toBe(39);
    expect(diasAvisoProporcional("2026-01-05", "2026-09-20")).toBe(30);
    expect(diasAvisoProporcional("1990-01-01", "2026-09-20")).toBe(90);
  });

  it("avos: mês completo ou fração de 15 dias ou mais", () => {
    expect(avosEntre("2026-03-10", "2026-10-29")).toBe(8);
    expect(avosEntre("2026-03-10", "2026-09-20")).toBe(6);
  });

  it("dispensa sem justa causa com aviso indenizado", () => {
    const r = simularRescisao(base);
    expect(r.valido).toBe(true);
    expect(r.dataProjetada).toBe("2026-10-29");
    expect(verba(r, "saldo")).toBe("2000.00");
    expect(verba(r, "aviso")).toBe("3900.00");
    expect(verba(r, "13")).toBe("2500.00");
    expect(verba(r, "ferias_prop")).toBe("2000.00");
    expect(verba(r, "terco")).toBe("666.67");
    expect(r.totalProventos.toFixed(2)).toBe("11066.67");
    expect(r.fgtsMes.toFixed(2)).toBe("672.00");
    expect(r.multaFgts.toFixed(2)).toBe("3868.80");
    expect(r.encargos.toFixed(2)).toBe("0.00");
    expect(r.custoTotal.toFixed(2)).toBe("15607.47");
  });

  it("acordo (art. 484-A): metade do aviso e multa de 20%", () => {
    const r = simularRescisao({ ...base, tipo: "acordo" });
    expect(verba(r, "aviso")).toBe("1950.00");
    expect(r.dataProjetada).toBe("2026-10-09");
    expect(verba(r, "13")).toBe("2250.00");
    expect(verba(r, "ferias_prop")).toBe("1750.00");
    // FGTS: 8% × (2.000 + 1.950 + 2.250) = 496; multa 20% × (9.000 + 496)
    expect(r.fgtsMes.toFixed(2)).toBe("496.00");
    expect(r.multaFgts.toFixed(2)).toBe("1899.20");
  });

  it("pedido de demissão sem cumprir o aviso: desconto de 30 dias e sem multa", () => {
    const r = simularRescisao({ ...base, tipo: "pedido_demissao", aviso: "descontado" });
    expect(r.proventos.some((v) => v.chave === "aviso")).toBe(false);
    expect(r.descontos.find((d) => d.chave === "aviso_descontado")?.valor.toFixed(2)).toBe("3000.00");
    expect(r.totalProventos.toFixed(2)).toBe("6250.00");
    expect(r.multaFgts.toFixed(2)).toBe("0.00");
    // 6.250 − 3.000 + FGTS 8% × (2.000 + 2.250)
    expect(r.custoTotal.toFixed(2)).toBe("3590.00");
  });

  it("justa causa: só saldo de salário e férias vencidas com 1/3", () => {
    const r = simularRescisao({ ...base, tipo: "justa_causa", feriasVencidas: 1 });
    expect(r.proventos.map((v) => v.chave)).toEqual(["saldo", "ferias_vencidas_0", "terco"]);
    expect(r.totalProventos.toFixed(2)).toBe("6000.00");
  });

  it("encargos fora do Simples sobre saldo de salário e 13º", () => {
    const r = simularRescisao({ ...base, tipoFolha: "geral", rat: 2, fap: 1, terceiros: 5.8 });
    // 27,8% × (2.000 + 2.500)
    expect(r.encargos.toFixed(2)).toBe("1251.00");
  });

  it("saldo do FGTS estimado quando não informado", () => {
    const r = simularRescisao({ ...base, saldoFgts: null });
    expect(r.saldoFgtsEstimado).toBe(true);
    // 8% × 3.000 × 42 meses × (1 + 1/12 + 1/36)
    expect(r.saldoFgts.toFixed(2)).toBe("11200.00");
  });

  it("valida as datas", () => {
    expect(simularRescisao({ ...base, desligamento: "2020-01-01" }).valido).toBe(false);
    expect(simularRescisao({ ...base, tipo: "fim_experiencia", fimContrato: null }).valido).toBe(false);
  });
});
