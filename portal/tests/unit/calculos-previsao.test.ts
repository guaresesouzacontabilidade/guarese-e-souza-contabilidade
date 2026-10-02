import { describe, expect, it } from "vitest";
import { inssEmpregado, irrfMensal } from "@/lib/calculos/folha";
import { calcularPrevisao, type DadosPrevisao, type MesDados, type ParametrosCalculo } from "@/lib/calculos/previsao";
import { somarMeses } from "@/lib/competencia";

const PARAMS: ParametrosCalculo = {
  inicio_atividade: null,
  mei_atividade: null,
  anexo_mercadorias: "I",
  anexo_servicos: "III",
  fator_r: false,
  presuncao_irpj_mercadorias: 8,
  presuncao_irpj_servicos: 32,
  presuncao_csll_mercadorias: 12,
  presuncao_csll_servicos: 32,
  acrescimo_lc224: true,
  creditos_pis_cofins: true,
  aliquota_iss: null,
  calcular_icms: true,
  calcular_ipi: false,
  rat: 2,
  fap: 1,
  terceiros: 5.8,
  pro_labore: 0,
  socios_pro_labore: 1,
};

function mes(competencia: string, valores: Partial<MesDados> = {}): MesDados {
  return {
    competencia,
    vendas: 0,
    vendas_st: 0,
    icms_vendas: 0,
    servicos_nfe: 0,
    devolucoes: 0,
    icms_devolucoes: 0,
    compras: 0,
    icms_compras: 0,
    servicos: 0,
    servicos_retido: 0,
    iss_destacado: 0,
    servicos_sem_iss: 0,
    iss_retido: 0,
    icms_debito: 0,
    icms_credito: 0,
    ipi_debito: 0,
    ipi_credito: 0,
    notas_saida: 0,
    notas_entrada: 0,
    informado: null,
    ...valores,
  };
}

/** 12 meses anteriores com receita informada + o mês da competência. */
function historico(comp: string, merc: number, serv: number, folha: number | null, atual: Partial<MesDados>): MesDados[] {
  const meses: MesDados[] = [];
  for (let i = -12; i < 0; i++) {
    meses.push(mes(somarMeses(comp, i), { informado: { receita_mercadorias: merc, receita_servicos: serv, folha_fator_r: folha, observacao: null } }));
  }
  meses.push(mes(comp, atual));
  return meses;
}

function dados(regime: string, meses: MesDados[], extra: Partial<DadosPrevisao> = {}, params: Partial<ParametrosCalculo> = {}): DadosPrevisao {
  const comp = meses[meses.length - 1].competencia;
  return {
    competencia: comp,
    empresa: { nome: "Teste", regime, lucro_real_apuracao: null, contribuinte_icms: false, contribuinte_iss: false, tem_empregados: false, tem_pro_labore: false, uf: "TO" },
    parametros: { ...PARAMS, ...params },
    meses,
    checklist: { itens: 2, obrigatorios: 2, faltantes: [] },
    colaboradores: [],
    ajustes: [],
    vencimentos: [],
    guias_publicadas: 0,
    ...extra,
  };
}

const valor = (p: ReturnType<typeof calcularPrevisao>, chave: string) => p.linhas.find((l) => l.chave === chave)?.valor.toFixed(2);

describe("folha: INSS e IRRF de 2026", () => {
  it("INSS progressivo por faixa e limitado ao teto", () => {
    expect(inssEmpregado(1621, "2026-09-01").toFixed(2)).toBe("121.58");
    expect(inssEmpregado(3000, "2026-09-01").toFixed(2)).toBe("248.60");
    expect(inssEmpregado(20000, "2026-09-01").toFixed(2)).toBe("988.09");
  });

  it("IRRF com a redução da Lei 15.270/2025", () => {
    expect(irrfMensal(5000, inssEmpregado(5000, "2026-09-01"), 0, "2026-09-01").toFixed(2)).toBe("0.00");
    // R$ 6.000: tabela 564,85 − redução (978,62 − 0,133145 × 6.000 = 179,75)
    expect(irrfMensal(6000, inssEmpregado(6000, "2026-09-01"), 0, "2026-09-01").toFixed(2)).toBe("385.10");
    // Acima de R$ 7.350 não há redução: (10.000 − 988,09) × 27,5% − 908,73
    expect(irrfMensal(10000, inssEmpregado(10000, "2026-09-01"), 0, "2026-09-01").toFixed(2)).toBe("1569.55");
  });
});

describe("previsão de impostos", () => {
  it("MEI: DAS fixo pelo salário mínimo de 2026", () => {
    const p = calcularPrevisao(dados("mei", [mes("2026-09-01")], {}, { mei_atividade: "comercio_servicos" }));
    expect(valor(p, "das_mei")).toBe("87.05");
    expect(p.totalPagar.toFixed(2)).toBe("87.05");
  });

  it("Simples Anexo I: alíquota efetiva pela receita de 12 meses e vendas com ICMS-ST", () => {
    // RBT12 = 300.000 → 2ª faixa: (300.000 × 7,3% − 5.940) / 300.000 = 5,32%
    const meses = historico("2026-09-01", 25000, 0, null, { vendas: 30000, vendas_st: 10000, notas_saida: 12 });
    const p = calcularPrevisao(dados("simples_nacional", meses));
    // 20.000 × 5,32% + 10.000 × 5,32% × (1 − 34%)
    expect(valor(p, "das")).toBe("1415.12");
  });

  it("Simples Anexo V com Fator R: folha alta leva os serviços ao Anexo III", () => {
    const comMuitaFolha = historico("2026-09-01", 0, 50000, 15000, { servicos: 50000, notas_saida: 5 });
    const p1 = calcularPrevisao(dados("simples_nacional", comMuitaFolha, {}, { anexo_servicos: "V", fator_r: true }));
    // r = 180.000 / 600.000 = 30% → Anexo III, 3ª faixa: 10,56%
    expect(valor(p1, "das")).toBe("5280.00");

    const comPoucaFolha = historico("2026-09-01", 0, 50000, 10000, { servicos: 50000, notas_saida: 5 });
    const p2 = calcularPrevisao(dados("simples_nacional", comPoucaFolha, {}, { anexo_servicos: "V", fator_r: true }));
    // r = 20% → Anexo V, 3ª faixa: 17,85%
    expect(valor(p2, "das")).toBe("8925.00");
  });

  it("Lucro Presumido: PIS/Cofins do mês e IRPJ/CSLL no fim do trimestre", () => {
    const meses = [
      mes("2026-07-01", { servicos: 100000, notas_saida: 3 }),
      mes("2026-08-01", { servicos: 100000, notas_saida: 3 }),
      mes("2026-09-01", { servicos: 100000, notas_saida: 3 }),
    ];
    const p = calcularPrevisao(dados("lucro_presumido", meses));
    expect(valor(p, "pis")).toBe("650.00");
    expect(valor(p, "cofins")).toBe("3000.00");
    // Base 96.000: 15% = 14.400 + adicional 10% × 36.000
    expect(valor(p, "irpj")).toBe("18000.00");
    expect(valor(p, "csll")).toBe("8640.00");
    expect(p.linhas.find((l) => l.chave === "irpj")?.grupo).toBe("pagar");
  });

  it("Lucro Presumido fora do fim do trimestre: IRPJ/CSLL como reserva", () => {
    const p = calcularPrevisao(dados("lucro_presumido", [mes("2026-08-01", { servicos: 100000, notas_saida: 3 })]));
    expect(p.linhas.find((l) => l.chave === "irpj")?.grupo).toBe("provisao");
    expect(valor(p, "irpj")).toBe("6000.00"); // 32.000 × 15% + 10% × 12.000
    expect(p.totalPagar.toFixed(2)).toBe("3650.00"); // só PIS e Cofins vencem no mês seguinte
  });

  it("LC 224/2025: presunção 10% maior sobre a receita acima de R$ 1,25 milhão no trimestre", () => {
    const meses = [
      mes("2026-07-01", { servicos: 500000, notas_saida: 3 }),
      mes("2026-08-01", { servicos: 500000, notas_saida: 3 }),
      mes("2026-09-01", { servicos: 500000, notas_saida: 3 }),
    ];
    const p = calcularPrevisao(dados("lucro_presumido", meses));
    // Base: 1.250.000 × 32% + 250.000 × 35,2% = 488.000 → 73.200 + 42.800
    expect(valor(p, "irpj")).toBe("116000.00");
    const sem = calcularPrevisao(dados("lucro_presumido", meses, {}, { acrescimo_lc224: false }));
    expect(valor(sem, "irpj")).toBe("114000.00");
  });

  it("folha fora do Simples: INSS patronal, RAT, terceiros, descontos e FGTS", () => {
    const p = calcularPrevisao(
      dados("lucro_presumido", [mes("2026-08-01", { servicos: 10000, notas_saida: 1 })], {
        colaboradores: [{ admissao: "2025-01-10", desligamento: null, salario: 3000, adicionais: 0, dependentes_ir: 0 }],
      }),
    );
    // 20% + 2% + 5,8% de 3.000 = 834 + INSS do empregado 248,60
    expect(valor(p, "folha_inss_irrf")).toBe("1082.60");
    expect(valor(p, "fgts")).toBe("240.00");
  });

  it("Simples (fora do Anexo IV): a contribuição patronal fica no DAS; só os descontos e o FGTS", () => {
    const meses = historico("2026-08-01", 20000, 0, null, { vendas: 20000, notas_saida: 4 });
    const p = calcularPrevisao(
      dados("simples_nacional", meses, {
        colaboradores: [{ admissao: "2025-01-10", desligamento: null, salario: 3000, adicionais: 0, dependentes_ir: 0 }],
      }),
    );
    expect(valor(p, "folha_inss_irrf")).toBe("248.60");
    expect(valor(p, "fgts")).toBe("240.00");
  });

  it("vencimento e valor da guia vêm das tarefas de obrigações; ajustes do escritório entram no total", () => {
    const p = calcularPrevisao(
      dados("mei", [mes("2026-09-01")], {
        vencimentos: [{ codigo: "MEI_DAS", vencimento: "2026-10-20", valor_guia: "87.05", concluida: false }],
        ajustes: [{ id: "a1", descricao: "Parcelamento", valor: "100.00", observacao: null }],
      }, { mei_atividade: "comercio_servicos" }),
    );
    const das = p.linhas.find((l) => l.chave === "das_mei");
    expect(das?.vencimento).toBe("2026-10-20");
    expect(das?.valorGuia?.toFixed(2)).toBe("87.05");
    expect(p.totalPagar.toFixed(2)).toBe("187.05");
  });

  it("sem parâmetros ou regime sem cálculo automático", () => {
    expect(calcularPrevisao({ ...dados("simples_nacional", [mes("2026-09-01")]), parametros: null }).situacao).toBe("sem_parametros");
    expect(calcularPrevisao(dados("imune_isenta", [mes("2026-09-01")])).situacao).toBe("regime_nao_suportado");
    expect(calcularPrevisao(dados("simples_nacional", [mes("2025-12-01")])).situacao).toBe("competencia_nao_suportada");
  });
});
