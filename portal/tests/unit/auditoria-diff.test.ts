import { describe, expect, it } from "vitest";
import { compararDados, formatarValor } from "@/lib/auditoria/diff";

describe("comparação de dados da auditoria", () => {
  it("inclusão traz somente os valores novos", () => {
    const r = compararDados(null, { nome: "Empresa", ativa: true });
    expect(r).toEqual([
      { campo: "ativa", antes: undefined, depois: true, tipo: "incluido" },
      { campo: "nome", antes: undefined, depois: "Empresa", tipo: "incluido" },
    ]);
  });

  it("exclusão traz somente os valores anteriores", () => {
    const r = compararDados({ nome: "Contato" }, null);
    expect(r).toEqual([{ campo: "nome", antes: "Contato", depois: undefined, tipo: "removido" }]);
  });

  it("alteração compara campo a campo (inclusive arrays e nulos)", () => {
    const r = compararDados(
      { permissoes: ["empresa.ver"], email: null, uf: "TO" },
      { permissoes: ["empresa.ver", "documentos.ver"], email: "a@b.com", uf: "TO" },
    );
    expect(r.map((c) => [c.campo, c.tipo])).toEqual([
      ["email", "alterado"],
      ["permissoes", "alterado"],
      ["uf", "igual"],
    ]);
  });

  it("ignora conteúdo que não é objeto", () => {
    expect(compararDados("x", 3)).toEqual([]);
  });

  it("formata valores para exibição", () => {
    expect(formatarValor(null)).toBe("(vazio)");
    expect(formatarValor(true)).toBe("sim");
    expect(formatarValor(false)).toBe("não");
    expect(formatarValor(12)).toBe("12");
    expect(formatarValor(["a"])).toBe('[\n  "a"\n]');
    expect(formatarValor(undefined)).toBe("");
  });
});
