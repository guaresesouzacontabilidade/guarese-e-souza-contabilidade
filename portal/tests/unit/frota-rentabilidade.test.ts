import { describe, expect, it } from "vitest";
import { cadaCem, calcularFrota, calcularVeiculo, fatorDoMes, type DespesaFrota, type VeiculoFrota, type ViagemFrota } from "@/lib/frota/rentabilidade";

/** Contas da rentabilidade: lucro de verdade, km rodado, média, alertas e rateio. */
const veiculo: VeiculoFrota = {
  id: "v1",
  placa: "ABC1D23",
  descricao: "Volvo FH 540",
  tipo: "cavalo",
  km_inicial: 340000,
  custo_motorista_mensal: 6000,
  depreciacao_mensal: 0,
  financiamento_mensal: 10000,
  seguro_mensal: 1000,
  outros_fixos_mensal: 0,
};
const viagem = (id: string, frete: number): ViagemFrota => ({
  id,
  veiculo_id: "v1",
  data: "2026-09-05",
  cte_numero: id,
  remetente: null,
  origem: null,
  destinatario: null,
  destino: null,
  mercadoria: null,
  motorista: null,
  peso_kg: null,
  valor_frete: frete,
  icms: 0,
  comissao_motorista: frete * 0.1,
  quebra: 0,
  outras_deducoes: 0,
});
const abastecimento = (id: string, data: string, km: number, litros: number, valor: number): DespesaFrota => ({
  id,
  veiculo_id: "v1",
  data,
  grupo: "combustivel",
  fornecedor: null,
  documento: null,
  descricao: "Diesel",
  litros,
  km,
  valor,
});

describe("rentabilidade da frota", () => {
  it("resultado líquido desconta comissão, despesas, fixos e rateio", () => {
    const r = calcularVeiculo(veiculo, [viagem("1", 30000), viagem("2", 20000)], [abastecimento("a", "2026-09-03", 341000, 500, 3100), abastecimento("b", "2026-09-10", 342100, 500, 3100)], {
      kmAntes: 340000,
      fatorFixos: 1,
      rateio: 2000,
    });
    expect(r.faturamento).toBe(50000);
    expect(r.comissao).toBe(5000);
    expect(r.sobraViagens).toBe(50000 - 5000 - 6200);
    expect(r.fixos.total).toBe(17000);
    expect(r.lucro).toBe(50000 - 5000 - 6200 - 17000 - 2000);
    expect(r.margem).toBe(39.6);
    expect(r.km).toEqual({ inicial: 340000, final: 342100, rodado: 2100 });
    expect(r.mediaKmL).toBe(2.1);
    expect(r.despesas.map((d) => d.media)).toEqual([2, 2.2]);
    expect(r.semaforo).toBe("verde");
  });

  it("aponta média fora da faixa (litros digitados errado) e resultado negativo", () => {
    const r = calcularVeiculo(veiculo, [viagem("1", 5000)], [abastecimento("a", "2026-09-03", 341000, 100, 620)], { kmAntes: 340000, fatorFixos: 1, rateio: 0 });
    expect(r.despesas[0].media).toBe(10);
    expect(r.despesas[0].alerta).toMatch(/fora da faixa esperada/);
    expect(r.semaforo).toBe("vermelho");
    expect(r.alertas.join(" ")).toMatch(/Resultado negativo/);
  });

  it("rateia o escritório pela parte de cada caminhão no frete e divide cada R$ 100", () => {
    const outro = { ...veiculo, id: "v2", placa: "XYZ9K88" };
    const f = calcularFrota([veiculo, outro], [viagem("1", 30000), { ...viagem("2", 10000), veiculo_id: "v2" }], [], {
      kmAntes: {},
      fatorFixos: 1,
      rateioTotal: 4000,
    });
    expect(f.veiculos.map((v) => [v.veiculo.placa, v.rateio])).toEqual([
      ["ABC1D23", 3000],
      ["XYZ9K88", 1000],
    ]);
    const fatias = cadaCem(f.veiculos[0]);
    expect(Math.round(fatias.reduce((s, x) => s + x.valor, 0))).toBe(100);
  });

  it("mês em andamento conta os custos fixos só até hoje", () => {
    expect(fatorDoMes("2026-10", "2026-10-27")).toBeCloseTo(27 / 31, 3);
    expect(fatorDoMes("2026-09", "2026-10-27")).toBe(1);
    expect(fatorDoMes("2026-11", "2026-10-27")).toBe(0);
  });
});
