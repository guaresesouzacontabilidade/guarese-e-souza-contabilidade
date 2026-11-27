import { describe, expect, it } from "vitest";
import { ordemLancamentos } from "@/lib/financeiro/ordem-lancamentos";

describe("ordem das contas a pagar e a receber", () => {
  it("sem escolha, começa pela data mais antiga (hoje antes de 2027)", () => {
    expect(ordemLancamentos(null, "")).toBe("crescente");
    expect(ordemLancamentos(undefined, "em_aberto")).toBe("crescente");
    expect(ordemLancamentos("", "atrasado")).toBe("crescente");
  });

  it("histórico (quitadas e canceladas) começa pela mais nova", () => {
    expect(ordemLancamentos(null, "quitado")).toBe("decrescente");
    expect(ordemLancamentos(null, "cancelado")).toBe("decrescente");
  });

  it("a escolha da pessoa vale sempre", () => {
    expect(ordemLancamentos("decrescente", "em_aberto")).toBe("decrescente");
    expect(ordemLancamentos("crescente", "quitado")).toBe("crescente");
    expect(ordemLancamentos("qualquer", "")).toBe("crescente");
  });
});
