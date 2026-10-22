import { describe, expect, it } from "vitest";
import { SEM_PIS_COFINS, cfopExportacao } from "@/lib/nfe-emissao/rotulos";

describe("PIS/Cofins nas operações de venda", () => {
  it("CST que tiram as contribuições da nota", () => {
    expect(SEM_PIS_COFINS).toContain("08");
    expect(SEM_PIS_COFINS).toContain("09");
    expect(SEM_PIS_COFINS).not.toContain("01");
  });

  it("exportação e fim específico de exportação não acusam venda sem PIS/Cofins", () => {
    expect(cfopExportacao("7101")).toBe(true);
    expect(cfopExportacao("6.501")).toBe(true);
    expect(cfopExportacao("5501")).toBe(true);
    // Venda comum de milho para outro estado é tributada
    expect(cfopExportacao("6102")).toBe(false);
    expect(cfopExportacao("6101")).toBe(false);
  });
});
