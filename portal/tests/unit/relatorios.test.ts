import { describe, expect, it } from "vitest";
import { faixaAging, mesesEntre, montarAging, montarDre, montarFluxoMensal, percentual, periodoMensal, saldoDisponivel } from "@/lib/relatorios/calculos";
import { dec } from "@/lib/dinheiro";

describe("período mensal", () => {
  it("lista as competências do período", () => {
    expect(mesesEntre("2026-11-01", "2027-02-15")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  });
  it("usa padrão, inverte e limita a 24 meses", () => {
    expect(periodoMensal(undefined, undefined, "2026-10-01")).toEqual({ inicio: "2026-05-01", fim: "2026-10-01" });
    expect(periodoMensal("2026-09", "2026-03", "2026-10-01")).toEqual({ inicio: "2026-03-01", fim: "2026-09-01" });
    expect(periodoMensal("2020-01", "2026-12", "2026-10-01")).toEqual({ inicio: "2025-01-01", fim: "2026-12-01" });
  });
});

describe("fluxo de caixa mensal", () => {
  const base = { registro: "baixa", grupo: "operacional", conta_disponivel: true, conta_contrapartida_disponivel: null };
  it("soma realizado e previsto por mês, só no caixa disponível", () => {
    const f = montarFluxoMensal(
      ["2026-08-01", "2026-09-01"],
      [
        { ...base, data: "2026-08-10", entrada: 100.1, saida: 0 },
        { ...base, data: "2026-08-11", entrada: 0.2, saida: 0 },
        { ...base, data: "2026-09-02", entrada: 0, saida: "50.00" },
        // Cartão: não compõe o disponível
        { ...base, data: "2026-09-03", conta_disponivel: false, entrada: 0, saida: 999 },
        // Transferência entre contas disponíveis: ignorada
        { ...base, registro: "transferencia", grupo: "transferencia", data: "2026-09-04", conta_contrapartida_disponivel: true, entrada: 0, saida: 300 },
        // Pagamento de fatura (para conta não disponível): saída
        { ...base, registro: "transferencia", grupo: "transferencia", data: "2026-09-05", conta_contrapartida_disponivel: false, entrada: 0, saida: 20 },
        // Fora do período
        { ...base, data: "2026-10-01", entrada: 5, saida: 0 },
      ],
      [
        { tipo: "receber", data_vencimento: "2026-08-15", valor_previsto: "150.00" },
        { tipo: "pagar", data_vencimento: "2026-09-30", valor_previsto: 80 },
      ],
    );
    expect(f.meses[0].entradasRealizadas.toFixed(2)).toBe("100.30");
    expect(f.meses[1].saidasRealizadas.toFixed(2)).toBe("70.00");
    expect(f.meses[0].entradasPrevistas.toFixed(2)).toBe("150.00");
    expect(f.meses[1].saidasPrevistas.toFixed(2)).toBe("80.00");
    expect(f.totais.entradasRealizadas.toFixed(2)).toBe("100.30");
    expect(f.grupos.map((g) => [g.grupo, g.saidas.toFixed(2)])).toEqual([
      ["operacional", "50.00"],
      ["transferencia", "20.00"],
    ]);
  });
});

describe("DRE", () => {
  it("monta grupos, categorias e subtotais acumulados", () => {
    const linha = (mes: string, id: string, codigo: string, tipo: string, valor: number) => ({
      mes,
      categoria_id: id,
      categoria_codigo: codigo,
      categoria_nome: id,
      tipo,
      valor,
    });
    const d = montarDre(
      ["2026-08-01", "2026-09-01"],
      [
        linha("2026-08-01", "vendas", "1.01", "receita_operacional", 1000),
        linha("2026-09-01", "vendas", "1.01", "receita_operacional", 2000),
        linha("2026-08-01", "simples", "2.01", "deducao_receita", 60),
        linha("2026-08-01", "cmv", "3.01", "custo_mercadoria", 400),
        linha("2026-09-01", "aluguel", "4.02", "despesa_operacional", 500),
        linha("2026-09-01", "agua", "4.01", "despesa_operacional", 0.1),
        linha("2026-09-01", "juros", "5.02", "receita_financeira", 0.2),
        linha("2026-09-01", "irpj", "8.01", "impostos_lucro", 100),
      ],
    );
    const v = (chave: string) => d.linhas.find((l) => l.chave === chave)!.valores.map((x) => x.toFixed(2));
    expect(v("receita_liquida")).toEqual(["940.00", "2000.00"]);
    expect(v("lucro_bruto")).toEqual(["540.00", "2000.00"]);
    expect(v("resultado_operacional")).toEqual(["540.00", "1499.90"]);
    expect(v("resultado_antes_impostos")).toEqual(["540.00", "1500.10"]);
    expect(d.resultadoLiquido.total.toFixed(2)).toBe("1940.10");
    // Categorias ordenadas pelo código logo após o grupo
    const i = d.linhas.findIndex((l) => l.chave === "despesas");
    expect(d.linhas.slice(i + 1, i + 3).map((l) => l.chave)).toEqual(["agua", "aluguel"]);
    expect(percentual(d.resultadoLiquido.total, d.receitaBruta.total)).toBe(64.7);
    expect(percentual(dec(1), dec(0))).toBeNull();
  });
});

describe("contas por vencimento", () => {
  it("classifica nas faixas", () => {
    expect(faixaAging("2026-12-01", "2026-10-02")).toBe("vencer_mais_30");
    expect(faixaAging("2026-10-02", "2026-10-02")).toBe("vencer_30");
    expect(faixaAging("2026-10-01", "2026-10-02")).toBe("vencido_30");
    expect(faixaAging("2026-08-20", "2026-10-02")).toBe("vencido_60");
    expect(faixaAging("2026-07-10", "2026-10-02")).toBe("vencido_90");
    expect(faixaAging("2026-01-01", "2026-10-02")).toBe("vencido_mais_90");
  });
  it("soma o saldo em aberto e agrupa por contraparte", () => {
    const a = montarAging(
      [
        { tipo: "receber", data_vencimento: "2026-09-01", valor_previsto: "100.00", valor_baixado: "40.00", contraparte: "Cliente A" },
        { tipo: "receber", data_vencimento: "2026-10-10", valor_previsto: 0.3, valor_baixado: 0.1, contraparte: "Cliente A" },
        { tipo: "receber", data_vencimento: "2026-10-10", valor_previsto: 10, valor_baixado: 10, contraparte: "Cliente B" },
        { tipo: "pagar", data_vencimento: "2026-12-31", valor_previsto: 500, valor_baixado: 0, contraparte: null },
      ],
      "2026-10-02",
    );
    expect(a.receber.total.toFixed(2)).toBe("60.20");
    expect(a.receber.vencido.toFixed(2)).toBe("60.00");
    expect(a.receber.faixas.vencido_60.quantidade).toBe(1);
    expect(a.receber.maiores).toHaveLength(1);
    expect(a.receber.maiores[0].valor.toFixed(2)).toBe("60.20");
    expect(a.pagar.faixas.vencer_mais_30.valor.toFixed(2)).toBe("500.00");
    expect(a.pagar.maiores[0].nome).toBe("Sem cliente/fornecedor");
  });
});

describe("saldo disponível", () => {
  it("soma as contas disponíveis e indica falta de saldo", () => {
    const c = (saldo: number | null, disp = true) => ({
      conta_id: "x",
      nome: "x",
      tipo: "conta_corrente",
      compoe_saldo_disponivel: disp,
      saldo_sistema: saldo,
      saldo_extrato: null,
      saldo_extrato_data: null,
      movimentos_pendentes: 0,
      conciliado_ate: null,
    });
    const r = saldoDisponivel([c(0.1), c(0.2), c(1000, false), c(null)]);
    expect(r.valor!.toFixed(2)).toBe("0.30");
    expect(r.incompleto).toBe(true);
    expect(saldoDisponivel([]).valor).toBeNull();
  });
});
