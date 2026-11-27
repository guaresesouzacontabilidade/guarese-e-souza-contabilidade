import { describe, expect, it } from "vitest";
import { PERIODICIDADE, atrasada, descreverCalendario, ordemEntre, rotuloPeriodo, segundaDaSemana, semanasProximas } from "@/lib/rh/rotulos";

describe("Gestão de RH: rótulos das tarefas", () => {
  it("cada periodicidade tem texto e cor próprios", () => {
    const rotulos = Object.values(PERIODICIDADE).map((p) => p.rotulo);
    const cores = Object.values(PERIODICIDADE).map((p) => p.classe.split(" ")[1]);
    expect(rotulos).toEqual(["Diária", "Semanal", "Quinzenal", "Mensal"]);
    expect(new Set(cores).size).toBe(4);
  });

  it("período em palavras", () => {
    expect(rotuloPeriodo("diaria", "2026-11-26", "2026-11-26")).toBe("26/11/2026");
    expect(rotuloPeriodo("semanal", "2026-11-23", "2026-11-29")).toBe("Semana de 23/11 a 29/11/2026");
    expect(rotuloPeriodo("quinzenal", "2026-11-16", "2026-11-30")).toBe("2ª quinzena de novembro de 2026");
    expect(rotuloPeriodo("quinzenal", "2026-11-01", "2026-11-15")).toBe("1ª quinzena de novembro de 2026");
    expect(rotuloPeriodo("mensal", "2026-11-01", "2026-11-30")).toBe("Novembro de 2026");
  });

  it("calendário do modelo em palavras", () => {
    const base = { dias_semana: [1, 2, 3, 4, 5, 6], dia_semana: 5, dia_mes: 5, hora_limite: "18:00:00" };
    expect(descreverCalendario({ ...base, periodicidade: "diaria" })).toBe("Seg a sáb até 18:00");
    expect(descreverCalendario({ ...base, periodicidade: "diaria", dias_semana: [1, 3, 5] })).toBe("Seg, Qua, Sex até 18:00");
    expect(descreverCalendario({ ...base, periodicidade: "diaria", dias_semana: [1, 2, 3, 4, 5, 6, 7] })).toBe("Todo dia até 18:00");
    expect(descreverCalendario({ ...base, periodicidade: "semanal" })).toBe("Toda sexta-feira até 18:00");
    expect(descreverCalendario({ ...base, periodicidade: "semanal", dia_semana: 6 })).toBe("Todo sábado até 18:00");
    expect(descreverCalendario({ ...base, periodicidade: "mensal" })).toBe("Todo dia 5 até 18:00");
    expect(descreverCalendario({ ...base, periodicidade: "mensal", dia_mes: 31 })).toBe("Até o fim do mês até 18:00");
  });

  it("semana de referência: segunda-feira e as semanas vizinhas", () => {
    expect(segundaDaSemana("2026-11-26")).toBe("2026-11-23");
    expect(segundaDaSemana("2026-11-29")).toBe("2026-11-23");
    expect(segundaDaSemana("2026-11-23")).toBe("2026-11-23");
    expect(semanasProximas("2026-11-26").map((s) => s.valor)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  });

  it("atrasada só quando passou do prazo e não foi concluída", () => {
    const agora = new Date("2026-11-26T22:00:00Z").getTime();
    expect(atrasada({ status: "a_fazer", prazo: "2026-11-26T21:00:00Z" }, agora)).toBe(true);
    expect(atrasada({ status: "concluida", prazo: "2026-11-26T21:00:00Z" }, agora)).toBe(false);
    expect(atrasada({ status: "em_andamento", prazo: "2026-11-27T21:00:00Z" }, agora)).toBe(false);
  });

  it("ordem ao soltar o cartão entre outros", () => {
    expect(ordemEntre(1, 3)).toBe(2);
    expect(ordemEntre(null, 5)).toBe(4);
    expect(ordemEntre(5, null)).toBe(6);
  });
});
