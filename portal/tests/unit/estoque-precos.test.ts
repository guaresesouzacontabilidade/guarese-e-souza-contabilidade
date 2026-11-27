import { describe, expect, it } from "vitest";
import {
  custoMudouSemPreco,
  custoReferencia,
  lucroUnitario,
  m3PorUnidade,
  margemAlvo,
  margemReal,
  precoPorM3,
  precoSugerido,
} from "@/lib/gestao/precos";
import {
  arredondarCompra,
  curvaAbc,
  diasDeCobertura,
  estoquePorGrupo,
  mediaDiaria,
  produtosParados,
  sugestaoCompra,
  totaisEstoque,
  type ProdutoAnalise,
  type VendaProduto,
} from "@/lib/gestao/analise-estoque";
import { Decimal } from "@/lib/dinheiro";

describe("preço e margem (sobre o custo)", () => {
  it("custo 100 com 30% dá 130; margem real e lucro", () => {
    expect(precoSugerido("100", 30)?.toString()).toBe("130");
    expect(precoSugerido("33.33", "35")?.toFixed(2)).toBe("45.00");
    expect(margemReal("130", "100")).toBe(30);
    expect(margemReal("45.5", "35")).toBe(30);
    expect(lucroUnitario("130", "100")?.toString()).toBe("30");
  });

  it("sem custo não há margem nem sugestão", () => {
    expect(margemReal("50", null)).toBeNull();
    expect(margemReal("50", "0")).toBeNull();
    expect(precoSugerido(null, 30)).toBeNull();
    expect(precoSugerido("10", null)).toBeNull();
    expect(precoSugerido("10", -5)).toBeNull();
  });

  it("meta: a do produto, senão a do grupo, senão a padrão", () => {
    const grupos = { Pinus: "40" };
    expect(margemAlvo({ margem_desejada: "25", grupo: "Pinus" }, grupos, "30")).toEqual({ valor: 25, origem: "produto" });
    expect(margemAlvo({ margem_desejada: null, grupo: "Pinus" }, grupos, "30")).toEqual({ valor: 40, origem: "grupo" });
    expect(margemAlvo({ margem_desejada: null, grupo: "Eucalipto" }, grupos, "30")).toEqual({ valor: 30, origem: "padrao" });
    expect(margemAlvo({ margem_desejada: null, grupo: null }, grupos, null)).toBeNull();
    // Margem zero é uma meta válida (vender pelo custo)
    expect(margemAlvo({ margem_desejada: "0", grupo: "Pinus" }, grupos, "30")).toEqual({ valor: 0, origem: "produto" });
    expect(margemAlvo({ margem_desejada: "", grupo: "Pinus" }, grupos, "30")?.origem).toBe("grupo");
  });

  it("custo de referência: última compra, senão o cadastrado, senão o médio", () => {
    expect(custoReferencia({ ultimo_custo_entrada: "12", preco_custo: "10", custo_medio: "11" })?.toString()).toBe("12");
    expect(custoReferencia({ ultimo_custo_entrada: null, preco_custo: "10", custo_medio: "11" })?.toString()).toBe("10");
    expect(custoReferencia({ ultimo_custo_entrada: "0", preco_custo: null, custo_medio: "11" })?.toString()).toBe("11");
    expect(custoReferencia({})).toBeNull();
  });

  it("custo mudou e o preço não", () => {
    const base = { preco_alterado_em: "2026-11-01T10:00:00Z", custo_na_alteracao: "100" };
    expect(custoMudouSemPreco({ ...base, ultima_entrada_em: "2026-11-10T10:00:00Z", ultimo_custo_entrada: "110" })).toBe(true);
    // Mudança pequena (até 0,5%) não conta
    expect(custoMudouSemPreco({ ...base, ultima_entrada_em: "2026-11-10T10:00:00Z", ultimo_custo_entrada: "100.4" })).toBe(false);
    // Preço mudou depois da entrada
    expect(custoMudouSemPreco({ ...base, ultima_entrada_em: "2026-10-10T10:00:00Z", ultimo_custo_entrada: "110" })).toBe(false);
    // Preço sem custo na época: qualquer entrada nova conta
    expect(custoMudouSemPreco({ preco_alterado_em: base.preco_alterado_em, custo_na_alteracao: null, ultima_entrada_em: "2026-11-10T10:00:00Z", ultimo_custo_entrada: "50" })).toBe(true);
    expect(custoMudouSemPreco({ ultima_entrada_em: null, preco_alterado_em: base.preco_alterado_em })).toBe(false);
  });

  it("m³ por unidade e preço por m³ (madeira)", () => {
    expect(m3PorUnidade({ unidade: "M3" })?.toString()).toBe("1");
    // Tábua 2,5 × 30 cm com 3 m = 0,0225 m³
    expect(m3PorUnidade({ unidade: "PC", espessura_cm: "2.5", largura_cm: "30", comprimento_m: "3" })?.toString()).toBe("0.0225");
    // Metro linear de caibro 5 × 6 cm = 0,003 m³
    expect(m3PorUnidade({ unidade: "M", espessura_cm: "5", largura_cm: "6" })?.toString()).toBe("0.003");
    expect(m3PorUnidade({ unidade: "PC", espessura_cm: "2.5", largura_cm: "30" })).toBeNull();
    expect(m3PorUnidade({ unidade: "KG" })).toBeNull();
    expect(precoPorM3("45", new Decimal("0.0225"))?.toString()).toBe("2000");
    expect(precoPorM3("45", null)).toBeNull();
  });
});

const produto = (p: Partial<ProdutoAnalise> & { id: string }): ProdutoAnalise => ({
  descricao: p.id,
  codigo: p.id,
  grupo: null,
  unidade: "PC",
  estoque_atual: "0",
  estoque_minimo: null,
  custo_medio: null,
  preco_custo: null,
  valor_unitario: null,
  controla_estoque: true,
  espessura_cm: null,
  largura_cm: null,
  comprimento_m: null,
  ...p,
});

const vendas = (lista: (Partial<VendaProduto> & { produto_id: string })[]) =>
  new Map(lista.map((v) => [v.produto_id, { quantidade: "0", faturamento: "0", custo: "0", vendas: 0, ultima_venda: null, ...v }]));

describe("reposição", () => {
  it("média por dia e dias de cobertura", () => {
    const m = mediaDiaria("60", 30);
    expect(m.toString()).toBe("2");
    expect(diasDeCobertura("15", m)).toBe(7);
    expect(diasDeCobertura("0", m)).toBe(0);
    expect(diasDeCobertura("10", new Decimal(0))).toBeNull();
  });

  it("arredonda a compra: peças inteiras, m³ com 3 casas", () => {
    expect(arredondarCompra(new Decimal("10.2"), "PC").toString()).toBe("11");
    expect(arredondarCompra(new Decimal("1.23456"), "m3").toString()).toBe("1.235");
    expect(arredondarCompra(new Decimal("-3"), "PC").toString()).toBe("0");
  });

  it("sugestão de compra: estoque para N dias, nunca abaixo do mínimo; o que acaba antes primeiro", () => {
    const ps = [
      produto({ id: "tabua", estoque_atual: "10", custo_medio: "30" }), // vende 2/dia, dura 5 dias
      produto({ id: "viga", unidade: "M3", estoque_atual: "1", custo_medio: "2000" }), // vende 0,1/dia, dura 10 dias
      produto({ id: "prego", unidade: "KG", estoque_atual: "2", estoque_minimo: "5", preco_custo: "14" }), // não vendeu, abaixo do mínimo
      produto({ id: "sobra", estoque_atual: "500", custo_medio: "1" }), // tem de sobra
      produto({ id: "servico", controla_estoque: false }),
    ];
    const r = sugestaoCompra(ps, vendas([{ produto_id: "tabua", quantidade: "60" }, { produto_id: "viga", quantidade: "3" }, { produto_id: "sobra", quantidade: "30" }]), 30, 30);
    expect(r.map((x) => x.produto.id)).toEqual(["tabua", "viga", "prego"]);
    expect(r[0].comprar.toString()).toBe("50"); // 60 para 30 dias − 10
    expect(r[0].valorCompra.toString()).toBe("1500");
    expect(r[0].cobertura).toBe(5);
    expect(r[1].comprar.toString()).toBe("2"); // 3 m³ − 1
    expect(r[2].comprar.toString()).toBe("3"); // mínimo 5 − 2
    expect(r[2].motivo).toBe("minimo");
    expect(r[2].cobertura).toBeNull();
  });

  it("produtos parados com o dinheiro empatado", () => {
    const ps = [
      produto({ id: "velho", estoque_atual: "10", custo_medio: "50" }),
      produto({ id: "recente", estoque_atual: "10", custo_medio: "50" }),
      produto({ id: "nunca", estoque_atual: "4", custo_medio: "100" }),
      produto({ id: "novo", estoque_atual: "4", custo_medio: "100" }),
      produto({ id: "zerado", estoque_atual: "0", custo_medio: "100" }),
    ];
    const v = vendas([
      { produto_id: "velho", ultima_venda: "2026-08-01" },
      { produto_id: "recente", ultima_venda: "2026-11-20" },
    ]);
    const entradas = new Map<string, string | null>([
      ["nunca", "2026-07-01T12:00:00Z"],
      ["novo", "2026-11-15T12:00:00Z"],
    ]);
    const r = produtosParados(ps, v, entradas, "2026-11-26", 60);
    expect(r.map((x) => x.produto.id)).toEqual(["velho", "nunca"]);
    expect(r[0].valorParado.toString()).toBe("500");
    expect(r[0].diasSemVender).toBe(117);
    expect(r[1].diasSemVender).toBeNull();
  });

  it("curva ABC pelo faturamento", () => {
    const ps = ["a", "b", "c", "d"].map((id) => produto({ id }));
    const r = curvaAbc(ps, vendas([
      { produto_id: "a", faturamento: "700", custo: "500", quantidade: "7" },
      { produto_id: "b", faturamento: "200", custo: "100", quantidade: "2" },
      { produto_id: "c", faturamento: "60", quantidade: "1" },
      { produto_id: "d", faturamento: "40", quantidade: "1" },
    ]));
    expect(r.map((x) => `${x.produto.id}${x.classe}`)).toEqual(["aA", "bA", "cB", "dC"]);
    expect(r[0].participacao).toBe(70);
    expect(r[1].acumulado).toBe(90);
    expect(r[0].lucro.toString()).toBe("200");
    expect(curvaAbc(ps, vendas([]))).toEqual([]);
  });

  it("estoque por grupo com m³ e valor", () => {
    const ps = [
      produto({ id: "t1", grupo: "Pinus", estoque_atual: "100", custo_medio: "30", espessura_cm: "2.5", largura_cm: "30", comprimento_m: "3" }),
      produto({ id: "v1", grupo: "Pinus", unidade: "M3", estoque_atual: "2", custo_medio: "1500" }),
      produto({ id: "p1", grupo: null, unidade: "KG", estoque_atual: "10", preco_custo: "14" }),
      produto({ id: "z1", grupo: "Pinus", estoque_atual: "0" }),
    ];
    const g = estoquePorGrupo(ps);
    expect(g[0].grupo).toBe("Pinus");
    expect(g[0].produtos).toBe(3);
    expect(g[0].semEstoque).toBe(1);
    expect(g[0].m3.toString()).toBe("4.25"); // 100 × 0,0225 + 2
    expect(g[0].valor.toString()).toBe("6000");
    expect(g[0].quantidades.PC.toString()).toBe("100");
    expect(g[1].grupo).toBe("Sem grupo");
    const t = totaisEstoque(ps);
    expect(t.valor.toString()).toBe("6140");
  });
});
