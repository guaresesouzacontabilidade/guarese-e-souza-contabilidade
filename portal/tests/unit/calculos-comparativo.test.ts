import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { compararRegimes, type PremissasComparativo } from "@/lib/calculos/comparativo";
import type { DadosPrevisao, MesDados, ParametrosCalculo } from "@/lib/calculos/previsao";
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

const ATE = "2026-09-01";

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

/** 24 meses anteriores + o mês final, todos com a mesma receita informada. */
function meses(merc: number, serv: number, extra: Partial<MesDados> = {}, semDados: string[] = []): MesDados[] {
  return Array.from({ length: 25 }, (_, i) => {
    const c = somarMeses(ATE, i - 24);
    if (semDados.includes(c)) return mes(c);
    return mes(c, { ...extra, informado: { receita_mercadorias: merc, receita_servicos: serv, folha_fator_r: null, observacao: null } });
  });
}

function dados(regime: string, lista: MesDados[], params: Partial<ParametrosCalculo> = {}, empresa: Partial<DadosPrevisao["empresa"]> = {}): DadosPrevisao {
  return {
    competencia: ATE,
    empresa: { nome: "Teste", regime, lucro_real_apuracao: null, contribuinte_icms: false, contribuinte_iss: false, tem_empregados: false, tem_pro_labore: false, uf: "TO", ...empresa },
    parametros: { ...PARAMS, ...params },
    meses: lista,
    checklist: null,
    colaboradores: [],
    ajustes: [],
    vencimentos: [],
    guias_publicadas: 0,
  };
}

const premissas = (p: Partial<PremissasComparativo> = {}): PremissasComparativo => ({
  margemLucro: null,
  aliquotaIcms: null,
  aliquotaIss: null,
  creditosPisCofins: true,
  ...p,
});

const regime = (c: ReturnType<typeof compararRegimes>, r: string) => c.regimes.find((x) => x.regime === r)!;
const v = (c: ReturnType<typeof compararRegimes>, r: string, t: string) => regime(c, r).tributos[t as "das"].valor.toFixed(2);

describe("comparativo de regimes", () => {
  it("comércio no Simples: DAS mês a mês, Presumido e Real com ICMS, créditos e margem", () => {
    const c = compararRegimes(
      dados("simples_nacional", meses(50000, 0, { compras: 30000, icms_compras: 6000, icms_credito: 6000 }), {}, { contribuinte_icms: true }),
      ATE,
      premissas({ margemLucro: new Decimal(10), aliquotaIcms: new Decimal(20) }),
    );
    expect(c.meses[0]).toBe("2025-10-01");
    expect(c.receita.total.toFixed(2)).toBe("600000.00");
    // Simples Anexo I, RBT12 de R$ 600 mil: (600.000 × 9,5% − 13.860) ÷ 600.000 = 7,19%
    expect(v(c, "simples_nacional", "das")).toBe("43140.00");
    expect(regime(c, "simples_nacional").tributos.icms.situacao).toBe("no_das");
    // Presumido: PIS/Cofins sem o ICMS na base, IRPJ/CSLL por trimestre, ICMS débito − crédito
    expect(v(c, "lucro_presumido", "pis")).toBe("3120.00");
    expect(v(c, "lucro_presumido", "cofins")).toBe("14400.00");
    expect(v(c, "lucro_presumido", "irpj")).toBe("7200.00");
    expect(v(c, "lucro_presumido", "csll")).toBe("6480.00");
    expect(v(c, "lucro_presumido", "icms")).toBe("48000.00");
    expect(regime(c, "lucro_presumido").total.toFixed(2)).toBe("79200.00");
    // Real: PIS/Cofins não cumulativos com créditos; IRPJ/CSLL sobre 10% de margem
    expect(v(c, "lucro_real", "pis")).toBe("3168.00");
    expect(v(c, "lucro_real", "cofins")).toBe("14592.00");
    expect(v(c, "lucro_real", "irpj")).toBe("9000.00");
    expect(v(c, "lucro_real", "csll")).toBe("5400.00");
    expect(regime(c, "lucro_real").total.toFixed(2)).toBe("80160.00");
    expect(c.melhor).toBe("simples_nacional");
    expect(c.economia).toBeNull();
    // A soma mês a mês fecha com o total
    for (const r of c.regimes) expect(r.porMes.reduce((s, x) => s.plus(x), new Decimal(0)).toFixed(2)).toBe(r.total.toFixed(2));
  });

  it("serviços do Anexo V: Presumido sai mais barato e mostra a economia; Real sem margem fica incompleto", () => {
    const c = compararRegimes(dados("simples_nacional", meses(0, 100000)), ATE, premissas({ aliquotaIss: new Decimal(5) }));
    // Simples Anexo V (sem Fator R), RBT12 de R$ 1,2 milhão: 19,075%
    const semFatorR = compararRegimes(dados("simples_nacional", meses(0, 100000), { anexo_servicos: "V" }), ATE, premissas({ aliquotaIss: new Decimal(5) }));
    expect(v(c, "simples_nacional", "das")).toBe("156360.00");
    expect(v(semFatorR, "simples_nacional", "das")).toBe("228900.00");
    // Presumido: 32% de presunção, adicional de 10% sobre o que passa de R$ 60 mil no trimestre, ISS de 5%
    expect(v(semFatorR, "lucro_presumido", "irpj")).toBe("72000.00");
    expect(v(semFatorR, "lucro_presumido", "csll")).toBe("34560.00");
    expect(v(semFatorR, "lucro_presumido", "iss")).toBe("60000.00");
    expect(regime(semFatorR, "lucro_presumido").total.toFixed(2)).toBe("210360.00");
    expect(regime(semFatorR, "lucro_real").faltando).toEqual(["a margem de lucro"]);
    // Sem a margem, o Real tem PIS/Cofins e ISS (R$ 171 mil), abaixo do Presumido: ainda pode sair mais barato
    expect(regime(semFatorR, "lucro_real").jaMaisCaro).toBe(false);
    expect(semFatorR.melhor).toBe("lucro_presumido");
    expect(semFatorR.economia?.toFixed(2)).toBe("18540.00");
    // Anexo III continua no Simples; o Real, mesmo sem o IRPJ e a CSLL, já passa do DAS
    expect(c.melhor).toBe("simples_nacional");
    expect(regime(c, "lucro_real").jaMaisCaro).toBe(true);
  });

  it("sem a alíquota do ICMS ou do ISS o regime fica incompleto e não entra na escolha", () => {
    const c = compararRegimes(dados("lucro_presumido", meses(40000, 10000)), ATE, premissas({ margemLucro: new Decimal(8) }));
    expect(regime(c, "lucro_presumido").faltando).toEqual(["a alíquota média do ICMS", "a alíquota do ISS"]);
    expect(c.melhor).toBe("simples_nacional");
    // Sem ICMS e ISS, o Presumido fica abaixo do DAS: ainda pode sair mais barato
    expect(regime(c, "lucro_presumido").jaMaisCaro).toBe(false);
    expect(c.economia).toBeNull();
  });

  it("acima de R$ 4,8 milhões não pode optar pelo Simples; LC 224/2025 por trimestre e só a partir da vigência", () => {
    const c = compararRegimes(dados("lucro_presumido", meses(600000, 0)), ATE, premissas({ aliquotaIcms: new Decimal(0), margemLucro: new Decimal(5) }));
    expect(regime(c, "simples_nacional").impedimento).toContain("limite do Simples");
    // IRPJ: 4º tri/2025 sem acréscimo (30.000); 2026 com acréscimo sobre R$ 550 mil (31.100 por trimestre)
    expect(v(c, "lucro_presumido", "irpj")).toBe("123300.00");
    // CSLL: acréscimo só a partir do 2º trimestre de 2026
    expect(v(c, "lucro_presumido", "csll")).toBe("78948.00");
    expect(c.fontes.some((f) => f.titulo.includes("224/2025"))).toBe(true);
    expect(c.melhor).not.toBe("simples_nacional");
  });

  it("mês sem notas nem receita informada entra como zero e gera aviso", () => {
    const c = compararRegimes(dados("simples_nacional", meses(30000, 0, {}, ["2026-03-01"])), ATE, premissas());
    expect(c.receita.mesesSemDados).toEqual(["2026-03-01"]);
    expect(c.receita.total.toFixed(2)).toBe("330000.00");
    expect(c.avisos[0]).toContain("03/2026");
  });

  it("folha: patronal fora do Simples com 13º e férias; no Simples (fora do Anexo IV) fica no DAS", () => {
    const d = dados("simples_nacional", meses(20000, 0), { pro_labore: 3000 }, { tem_empregados: true });
    d.colaboradores = [{ admissao: "2020-01-01", desligamento: null, salario: 3600, adicionais: 0, dependentes_ir: 0 }];
    const c = compararRegimes(d, ATE, premissas({ aliquotaIcms: new Decimal(0), margemLucro: new Decimal(10) }));
    expect(regime(c, "simples_nacional").tributos.patronal.situacao).toBe("no_das");
    // (3.600 × (1 + 1/12 + 1/36)) × (20% + 2% + 5,8%) + 3.000 × 20%, por 12 meses
    expect(v(c, "lucro_presumido", "patronal")).toBe("20544.00");
  });
});
