import { describe, expect, it } from "vitest";
import { composicaoDespesas, montarDre, type LinhaDreBruta } from "@/lib/relatorios/dre";
import { projetarSaldo, resumirFluxo, type LinhaFluxoBruta } from "@/lib/relatorios/fluxo";
import { calcularIndicadores, resumoExecutivo, type DadosSaude } from "@/lib/relatorios/indicadores";
import { lerPeriodo } from "@/lib/relatorios/periodo";

const linha = (mes: string, tipo: string, valor: number, cat = tipo, codigo = "1"): LinhaDreBruta => ({
  mes,
  origem: "lancamento",
  categoria_id: cat,
  categoria_codigo: codigo,
  categoria_nome: cat,
  tipo,
  valor,
});

describe("DRE gerencial", () => {
  const meses = ["2026-08-01", "2026-09-01"];
  const dre = montarDre(
    [
      linha("2026-08-01", "receita_operacional", 10000, "vendas", "1.01"),
      linha("2026-09-01", "receita_operacional", 12000, "vendas", "1.01"),
      linha("2026-09-01", "deducao_receita", 600, "das", "2.01"),
      linha("2026-09-01", "custo_mercadoria", 4000, "insumos", "3.02"),
      linha("2026-09-01", "despesa_operacional", 3000, "aluguel", "4.04"),
      linha("2026-09-01", "receita_financeira", 18.5, "juros", "5.02"),
      linha("2026-09-01", "despesa_financeira", 54.9, "tarifas", "5.04"),
    ],
    meses,
  );
  const total = (chave: string) => dre.totais[chave];

  it("calcula receita líquida, lucro bruto e resultado com os sinais corretos", () => {
    expect(total("receita_liquida").valores["2026-09-01"]).toBe("11400.00");
    expect(total("lucro_bruto").valores["2026-09-01"]).toBe("7400.00");
    expect(total("resultado_operacional").valores["2026-09-01"]).toBe("4400.00");
    expect(total("resultado_liquido").valores["2026-09-01"]).toBe("4363.60");
    expect(total("resultado_liquido").total).toBe("14363.60");
  });

  it("detalha as categorias dentro de cada grupo e calcula a análise vertical", () => {
    const cat = dre.linhas.find((l) => l.tipo === "categoria" && l.categoria_id === "aluguel");
    expect(cat?.valores["2026-09-01"]).toBe("-3000.00");
    const receita = dre.linhas.find((l) => l.chave === "receita_bruta");
    expect(receita?.percentual).toBe(100);
    // grupos sem movimento (ex.: outras receitas) não aparecem
    expect(dre.linhas.some((l) => l.chave === "outras_receitas")).toBe(false);
  });

  it("não cria a fatia “Outras” quando não sobra valor (zero não é positivo)", () => {
    const comp = composicaoDespesas(dre, 10);
    expect(comp.some((c) => c.nome === "Outras")).toBe(false);
    expect(comp.every((c) => c.valor > 0)).toBe(true);
  });

  it("lista as maiores despesas", () => {
    const comp = composicaoDespesas(dre, 2);
    expect(comp[0]).toEqual({ nome: "insumos", valor: 4000 });
    expect(comp[comp.length - 1].nome).toBe("Outras");
  });
});

describe("fluxo de caixa", () => {
  const base = { conta_contrapartida_disponivel: null, categoria_nome: "Vendas", tipo_categoria: "receita_operacional" };
  const linhas: LinhaFluxoBruta[] = [
    { ...base, data: "2026-09-05", registro: "baixa", conta_disponivel: true, grupo: "operacional", entrada: 1000, saida: 0 },
    { ...base, data: "2026-09-06", registro: "baixa", conta_disponivel: true, grupo: "operacional", entrada: 0, saida: 300, categoria_nome: "Aluguel" },
    // transferência interna (banco → caixa): não altera o caixa consolidado
    { ...base, data: "2026-09-07", registro: "transferencia", conta_disponivel: true, conta_contrapartida_disponivel: true, grupo: "transferencia", entrada: 0, saida: 200 },
    { ...base, data: "2026-09-07", registro: "transferencia", conta_disponivel: true, conta_contrapartida_disponivel: true, grupo: "transferencia", entrada: 200, saida: 0 },
    // aplicação em conta fora do disponível: sai do caixa
    { ...base, data: "2026-09-08", registro: "transferencia", conta_disponivel: true, conta_contrapartida_disponivel: false, grupo: "transferencia", entrada: 0, saida: 500 },
    // movimento em conta fora do disponível: ignorado
    { ...base, data: "2026-09-08", registro: "baixa", conta_disponivel: false, grupo: "operacional", entrada: 50, saida: 0 },
  ];

  it("consolida o caixa disponível e ignora transferências internas", () => {
    const f = resumirFluxo(linhas, ["2026-09-01"], 2000);
    expect(f.meses[0].entradas).toBe("1000.00");
    expect(f.meses[0].saidas).toBe("800.00");
    expect(f.meses[0].saldoFinal).toBe("2200.00");
    expect(f.total.geracao).toBe("200.00");
  });

  it("considera o saldo inicial de contas cadastradas durante o período", () => {
    const f = resumirFluxo([], ["2025-12-01", "2026-01-01"], 0, [{ data: "2025-12-31", valor: 15000 }]);
    expect(f.meses[0]).toMatchObject({ abertura: "15000.00", entradas: "0.00", saldoFinal: "15000.00" });
    expect(f.meses[1].saldoInicial).toBe("15000.00");
  });

  it("projeta o saldo e encontra o menor saldo futuro", () => {
    const p = projetarSaldo(
      [
        { data: "2026-09-25", vencido: true, origem: "lancamento", descricao: "Vencido", contraparte: null, entrada: 0, saida: 100 },
        { data: "2026-10-05", vencido: false, origem: "lancamento", descricao: "Aluguel", contraparte: null, entrada: 0, saida: 1500 },
        { data: "2026-10-10", vencido: false, origem: "lancamento", descricao: "Cliente", contraparte: null, entrada: 3000, saida: 0 },
      ],
      1000,
      "2026-10-02",
      "2026-12-31",
    );
    expect(p.pontos[0]).toMatchObject({ data: "2026-10-02", saldo: 900 });
    expect(p.menorSaldo).toEqual({ data: "2026-10-05", valor: "-600.00" });
    expect(p.janelas[0]).toMatchObject({ dias: 30, saldo: "2400.00" });
    expect(p.vencidos.saidas).toBe("100.00");
  });
});

describe("indicadores de saúde", () => {
  const dados: DadosSaude = {
    periodoRotulo: "setembro de 2026",
    anteriorRotulo: "agosto de 2026",
    receitaBruta: "20000",
    receitaBrutaAnterior: "16000",
    resultado: "3000",
    resultadoAnterior: "1000",
    saldoDisponivel: "30000",
    mediaSaidasMensais: "15000",
    aReceber30: "5000",
    aPagar30: "20000",
    receberVencido: "980",
    pagarVencido: "0",
    receitaTresMeses: "54000",
    maioresDespesas: [
      { nome: "Salários", valor: 4200 },
      { nome: "Aluguel", valor: 2500 },
    ],
    menorSaldoProjetado: { data: "2026-10-20", valor: "-150.00" },
    saldoProjetado30: "15000",
    qualidade: { competenciasFechadas: false, movimentosPendentes: 3, contasSemExtrato: 0, lancamentosSugeridos: 0, checklistPercentual: 100 },
  };

  it("classifica margem, fôlego, liquidez e inadimplência", () => {
    const ind = Object.fromEntries(calcularIndicadores(dados).map((i) => [i.chave, i]));
    expect(ind.resultado.status).toBe("bom"); // margem 15%
    expect(ind.folego.status).toBe("atencao"); // 2 meses
    expect(ind.liquidez.status).toBe("bom"); // 35.000 / 20.000 = 1,75
    expect(ind.inadimplencia.status).toBe("bom"); // 1,8%
    expect(ind.dados.status).toBe("atencao");
  });

  it("monta o resumo executivo em português, com alertas", () => {
    const texto = resumoExecutivo(dados).join(" ");
    expect(texto).toContain("25% acima de agosto de 2026");
    expect(texto).toContain("lucro de R$ 3.000,00");
    expect(texto).toContain("pode ficar negativo em 20/10/2026");
    expect(texto).toContain("preliminares");
  });
});

describe("períodos", () => {
  it("usa o mês anterior como padrão e calcula o período de comparação", () => {
    const p = lerPeriodo(null, "2026-10-02");
    expect(p).toMatchObject({ tipo: "mes", inicio: "2026-09-01", fim: "2026-09-30" });
    expect(p.anterior.inicio).toBe("2026-08-01");
  });
  it("aceita trimestres e ano em curso", () => {
    expect(lerPeriodo("2026-T3", "2026-10-02")).toMatchObject({ inicio: "2026-07-01", fim: "2026-09-30", meses: ["2026-07-01", "2026-08-01", "2026-09-01"] });
    const ano = lerPeriodo("2026", "2026-10-02");
    expect(ano.fim).toBe("2026-10-31");
    expect(ano.anterior.fim).toBe("2025-10-31");
  });
  it("aceita um período personalizado de um mês até outro", () => {
    const p = lerPeriodo("2026-04_2026-08", "2026-10-02");
    expect(p).toMatchObject({ tipo: "intervalo", chave: "2026-04_2026-08", inicio: "2026-04-01", fim: "2026-08-31", rotulo: "abril a agosto de 2026" });
    expect(p.meses).toHaveLength(5);
    // Comparação com os 5 meses imediatamente anteriores
    expect(p.anterior).toMatchObject({ inicio: "2025-11-01", fim: "2026-03-31", rotulo: "novembro de 2025 a março de 2026" });
    // Ordem invertida é corrigida; um mês só vira o período mensal
    expect(lerPeriodo("2026-08_2026-04", "2026-10-02").chave).toBe("2026-04_2026-08");
    expect(lerPeriodo("2026-06_2026-06", "2026-10-02").tipo).toBe("mes");
    // Limite de 36 meses (mantém o fim)
    const longo = lerPeriodo("2020-01_2026-08", "2026-10-02");
    expect(longo.meses).toHaveLength(36);
    expect(longo.fim).toBe("2026-08-31");
    // Mês inválido volta ao padrão
    expect(lerPeriodo("2026-13_2026-08", "2026-10-02").tipo).toBe("mes");
  });
});
