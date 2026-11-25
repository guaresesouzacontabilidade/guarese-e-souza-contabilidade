import { describe, expect, it } from "vitest";
import { montarDre, type LinhaDreBruta } from "@/lib/relatorios/dre";
import { linhaDaConta, linhasDoModelo, modeloPadrao, ordenarLinhas, type ModeloDre } from "@/lib/relatorios/modelo-dre";
import { naturezaDoTipo, proximoCodigo, tipoEntraNoDre } from "@/lib/financeiro/plano-contas";

const conta = (id: string, codigo: string, pai_id: string | null = null, sintetica = false) => ({ id, codigo, pai_id, sintetica });

describe("plano de contas: próximo código", () => {
  const contas = [
    conta("g4", "4", null, true),
    conta("a", "4.01", "g4"),
    conta("b", "4.12", "g4"),
    conta("c", "4.99", "g4"),
    conta("g8", "8", null, true),
    conta("d", "8.06", "g8"),
  ];

  it("conta no grupo: depois da maior, sem usar o 99 (Outras)", () => {
    expect(proximoCodigo(contas, "g4")).toBe("4.13");
    expect(proximoCodigo(contas, "g8")).toBe("8.07");
  });

  it("grupo novo: o próximo número inteiro", () => {
    expect(proximoCodigo(contas, null, true)).toBe("9");
    expect(proximoCodigo([...contas, conta("g10", "10", null, true)], null, true)).toBe("11");
  });

  it("conta sem grupo e grupo vazio", () => {
    expect(proximoCodigo(contas, null)).toBe("0.01");
    expect(proximoCodigo([...contas, conta("g9", "9", null, true)], "g9")).toBe("9.01");
  });

  it("pula o 99 quando o grupo chega lá", () => {
    const cheio = [conta("g", "5", null, true), conta("x", "5.98", "g")];
    expect(proximoCodigo(cheio, "g")).toBe("5.100");
  });

  it("natureza e DRE pelo tipo", () => {
    expect(naturezaDoTipo("receita_operacional")).toBe("receita");
    expect(naturezaDoTipo("deducao_receita")).toBe("despesa");
    expect(naturezaDoTipo("aporte_socio")).toBe("receita");
    expect(tipoEntraNoDre("despesa_operacional")).toBe(true);
    expect(tipoEntraNoDre("retirada_socio")).toBe(false);
  });
});

const bruta = (tipo: string, valor: number, cat: string, codigo: string, mes = "2026-09-01"): LinhaDreBruta => ({
  mes,
  origem: "lancamento",
  categoria_id: cat,
  categoria_codigo: codigo,
  categoria_nome: cat,
  tipo,
  valor,
});

describe("DRE personalizado", () => {
  const meses = ["2026-09-01"];
  const brutas = [
    bruta("receita_operacional", 10000, "vendas", "1.01"),
    bruta("deducao_receita", 600, "das", "2.01"),
    bruta("custo_mercadoria", 4000, "insumos", "3.02"),
    bruta("despesa_operacional", 2000, "salarios", "4.01"),
    bruta("despesa_operacional", 500, "beneficios", "4.03"),
    bruta("despesa_operacional", 1000, "aluguel", "4.04"),
    bruta("despesa_financeira", 50, "tarifas", "5.04"),
  ];
  const padrao = modeloPadrao();
  const linhaPessoal = { id: "pessoal", ordem: 5.5, tipo: "grupo" as const, rotulo: "(−) Despesas com pessoal", chave_padrao: null, tipos: [], mostrar_contas: true, oculta: false, destaque: false };
  const subtotal = { id: "margem", ordem: 5.6, tipo: "total" as const, rotulo: "Lucro depois do pessoal", chave_padrao: null, tipos: [], mostrar_contas: true, oculta: false, destaque: false };

  function modelo(extra: Partial<ModeloDre> = {}): ModeloDre {
    return {
      linhas: [...padrao, linhaPessoal, subtotal],
      categorias: [
        { id: "g4", pai_id: null, tipo: "despesa_operacional", dre_linha_id: null },
        { id: "salarios", pai_id: "g4", tipo: "despesa_operacional", dre_linha_id: "pessoal" },
        { id: "beneficios", pai_id: "g4", tipo: "despesa_operacional", dre_linha_id: "pessoal" },
        { id: "aluguel", pai_id: "g4", tipo: "despesa_operacional", dre_linha_id: null },
      ],
      ...extra,
    };
  }

  it("sem mudanças, o modelo padrão dá os mesmos números do DRE padrão", () => {
    const m: ModeloDre = { linhas: padrao, categorias: [] };
    const personalizado = linhasDoModelo(brutas, meses, m);
    const original = montarDre(brutas, meses).linhas;
    expect(personalizado.map((l) => [l.rotulo, l.total, l.tipo])).toEqual(original.map((l) => [l.rotulo, l.total, l.tipo]));
  });

  it("conta levada para a linha nova sai da linha do padrão; o subtotal soma tudo acima", () => {
    const linhas = linhasDoModelo(brutas, meses, modelo());
    const porRotulo = (r: string) => linhas.find((l) => l.rotulo === r);
    expect(porRotulo("(−) Despesas com pessoal")?.total).toBe("-2500.00");
    expect(porRotulo("(−) Despesas operacionais")?.total).toBe("-1000.00");
    expect(porRotulo("Lucro depois do pessoal")?.total).toBe("2900.00");
    expect(porRotulo("Resultado operacional")?.total).toBe("1900.00");
    expect(linhas.at(-1)).toMatchObject({ rotulo: "Resultado líquido (lucro ou prejuízo)", total: "1850.00", destaque: true });
    // A linha nova mostra as contas e guarda quais contas a compõem (para ver os lançamentos)
    expect(porRotulo("(−) Despesas com pessoal")?.categoria_ids).toEqual(["salarios", "beneficios"]);
    expect(linhas.filter((l) => l.tipo === "categoria" && l.chave.startsWith("linha:pessoal:")).map((l) => l.rotulo)).toEqual(["4.01 salarios", "4.03 beneficios"]);
  });

  it("grupo inteiro levado para uma linha leva as contas sem linha própria", () => {
    const m = modelo({
      categorias: [
        { id: "g4", pai_id: null, tipo: "despesa_operacional", dre_linha_id: "pessoal" },
        { id: "salarios", pai_id: "g4", tipo: "despesa_operacional", dre_linha_id: null },
        { id: "aluguel", pai_id: "g4", tipo: "despesa_operacional", dre_linha_id: null },
      ],
    });
    expect(linhaDaConta(m, "aluguel")?.id).toBe("pessoal");
    expect(linhaDaConta(m, "tarifas", "despesa_financeira")?.id).toBe("despesas_financeiras");
    expect(linhaDaConta(m, "aporte", "aporte_socio")).toBeNull();
  });

  it("recolher contas e esconder subtotal não mudam o resultado", () => {
    const linhas = linhasDoModelo(
      brutas,
      meses,
      modelo({
        linhas: [...padrao.map((l) => (l.chave_padrao === "lucro_bruto" ? { ...l, oculta: true } : l)), { ...linhaPessoal, mostrar_contas: false }, subtotal],
      }),
    );
    expect(linhas.find((l) => l.rotulo === "Lucro bruto")).toBeUndefined();
    expect(linhas.some((l) => l.chave.startsWith("linha:pessoal:"))).toBe(false);
    expect(linhas.at(-1)?.total).toBe("1850.00");
  });

  it("resultado líquido sempre por último e percentuais sobre a receita bruta", () => {
    const fora = padrao.map((l) => (l.chave_padrao === "resultado_liquido" ? { ...l, ordem: 1 } : l));
    expect(ordenarLinhas(fora).at(-1)?.chave_padrao).toBe("resultado_liquido");
    const linhas = linhasDoModelo(brutas, meses, modelo());
    expect(linhas.find((l) => l.rotulo === "(−) Despesas com pessoal")?.percentual).toBe(-25);
  });

  it("ajuste no resultado entra pela natureza da conta (e pode estornar)", () => {
    const comAjuste = [...brutas, { ...bruta("despesa_operacional", 300, "aluguel", "4.04"), origem: "ajuste_resultado" }, { ...bruta("despesa_operacional", -100, "aluguel", "4.04"), origem: "ajuste_resultado" }];
    const linhas = linhasDoModelo(comAjuste, meses, modelo());
    expect(linhas.find((l) => l.rotulo === "(−) Despesas operacionais")?.total).toBe("-1200.00");
    expect(linhas.at(-1)?.total).toBe("1650.00");
  });
});
