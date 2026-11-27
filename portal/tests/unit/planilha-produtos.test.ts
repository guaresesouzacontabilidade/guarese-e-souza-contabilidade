import { describe, expect, it } from "vitest";
import { acharCabecalho, analisarProdutos, dadosDaLinha, lerPlanilhaProdutos, normalizarTitulo } from "@/lib/gestao/planilha-produtos";

describe("planilha de produtos", () => {
  it("reconhece os títulos com ou sem acento, e com outros nomes comuns", () => {
    expect(normalizarTitulo("Preço de Venda (R$)")).toBe("preco de venda");
    const cab = acharCabecalho([
      ["Relação de produtos — Madeireira", null],
      ["Cód.", "Produto", "NCM", "Und", "Valor", "Saldo", "EAN"],
    ]);
    expect(cab?.indice).toBe(1);
    expect(cab?.colunas).toEqual({ codigo: 0, descricao: 1, ncm: 2, unidade: 3, preco_venda: 4, estoque: 5, gtin: 6 });
  });

  it("separa produtos novos, atualizações e linhas com erro", () => {
    const r = analisarProdutos(
      [
        ["Código", "Descrição", "NCM", "Unidade", "Preço de venda", "Preço de custo", "Estoque"],
        ["P-1", "Tábua de pinus", "4407.11.00", "un", "42,90", "28,5", "120"],
        ["P-2", null, null, null, "9,99", null, "1.234,5"],
        [null, "Sem NCM", null, "UN", "10", null, null],
        ["P-1", "Repetido", "44071100", "UN", "1", null, null],
        [null, null, null, null, null, null, null],
        ["P-3", "Negativo", "44071100", "UN", "5", null, "-3"],
      ],
      new Set(["P-2"]),
    );
    expect(r.erroGeral).toBeUndefined();
    expect(r.linhas.map((l) => [l.linha, l.situacao])).toEqual([
      [2, "novo"],
      [3, "atualizar"],
      [4, "erro"],
      [5, "erro"],
      [7, "erro"],
    ]);
    const [novo, atualiza, semNcm, repetido, negativo] = r.linhas;
    expect([novo.ncm, novo.unidade, novo.preco_venda, novo.preco_custo, novo.estoque]).toEqual(["44071100", "UN", "42.9", "28.5", "120"]);
    expect(atualiza.estoque).toBe("1234.5");
    expect(semNcm.erros).toEqual(["produto novo precisa de NCM"]);
    expect(repetido.erros).toEqual(["código repetido (também na linha 2)"]);
    expect(negativo.erros).toEqual(["estoque negativo"]);
  });

  it("números do Excel ficam como estão (sem confundir ponto com milhar) e perdem o resíduo do cálculo", () => {
    const r = analisarProdutos(
      [
        ["Descrição", "NCM", "Unidade", "Preço de venda", "Estoque"],
        ["Prego", "73170090", "KG", 1.5, 0.1 + 0.2],
      ],
      new Set(),
    );
    expect(r.linhas[0].preco_venda).toBe("1.5");
    expect(r.linhas[0].estoque).toBe("0.3");
  });

  it("sem títulos reconhecidos, explica como corrigir", () => {
    expect(analisarProdutos([["a", "b"], ["1", "2"]], new Set()).erroGeral).toMatch(/títulos das colunas/);
  });

  it("lê CSV com ponto e vírgula (padrão do Excel brasileiro)", async () => {
    const csv = "Código;Descrição;NCM;Unidade;Preço de venda\nX-1;Ripa 1,5 x 5;44079990;M;2,20\n";
    const celulas = await lerPlanilhaProdutos(new TextEncoder().encode(csv), "produtos.csv");
    const r = analisarProdutos(celulas, new Set());
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ codigo: "X-1", descricao: "Ripa 1,5 x 5", preco_venda: "2.2", situacao: "novo" });
    expect(Object.keys(dadosDaLinha(r.linhas[0]))).not.toContain("situacao");
  });
});
