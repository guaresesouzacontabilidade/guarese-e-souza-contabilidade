import { describe, expect, it } from "vitest";
import { cfopCompraNaEntrada, cfopDevolucaoNaEntrada } from "@/lib/auditor-fiscal/cfop";

describe("CFOP nas notas de entrada (inclusive as emitidas por terceiros)", () => {
  it("compra: nota própria de entrada ou venda do fornecedor, sem transferências e remessas", () => {
    for (const c of ["1102", "2102", "1403", "5102", "6102", "5405", "6404", "5656"]) expect(cfopCompraNaEntrada(c), c).toBe(true);
    for (const c of ["5152", "6152", "5910", "5949", "1202", "6202", null]) expect(cfopCompraNaEntrada(c), String(c)).toBe(false);
  });

  it("devolução de venda: nota própria ou nota do cliente que devolveu", () => {
    for (const c of ["1202", "2202", "1411", "5202", "6202", "5201", "5210", "5411", "6411", "5413", "5553", "6556", "5661"]) {
      expect(cfopDevolucaoNaEntrada(c), c).toBe(true);
    }
    for (const c of ["5102", "5209", "5208", "5949", "1102", ""]) expect(cfopDevolucaoNaEntrada(c), c).toBe(false);
  });
});
