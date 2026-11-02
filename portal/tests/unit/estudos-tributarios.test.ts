import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { estudarEmpresa, type AchadoAuditor, type DadosEstudo } from "@/lib/estudos/estudar";
import type { DadosPrevisao, MesDados, ParametrosCalculo } from "@/lib/calculos/previsao";
import { somarMeses } from "@/lib/competencia";

const ATE = "2026-10-01";
const HOJE = "2026-11-03";
const EMPRESA = "00000000-0000-0000-0000-000000000001";

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
  aliquota_iss: 5,
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

/** 24 meses até ATE com a mesma receita informada (e a folha do Fator R, se dada). */
function meses(merc: number, serv: number, folha: number | null = null): MesDados[] {
  return Array.from({ length: 25 }, (_, i) =>
    mes(somarMeses(ATE, i - 24), { informado: { receita_mercadorias: merc, receita_servicos: serv, folha_fator_r: folha, observacao: null } }),
  );
}

function previsao(regime: string, lista: MesDados[], params: Partial<ParametrosCalculo> | null = {}): DadosPrevisao {
  return {
    competencia: ATE,
    empresa: { nome: "Teste", regime, lucro_real_apuracao: null, contribuinte_icms: false, contribuinte_iss: true, tem_empregados: false, tem_pro_labore: true, uf: "TO" },
    parametros: params === null ? null : { ...PARAMS, ...params },
    meses: lista,
    checklist: null,
    colaboradores: [],
    ajustes: [],
    vencimentos: [],
    guias_publicadas: 0,
  };
}

function rodar(p: DadosPrevisao, auditor: Partial<DadosEstudo["auditor"]> = {}) {
  const r = estudarEmpresa(
    { previsao: p, auditor: { ultima_execucao: "2026-10-20T10:00:00Z", tem_notas: true, achados: [], ...auditor } },
    { empresaId: EMPRESA, ate: ATE, hoje: HOJE },
  );
  const por = Object.fromEntries(r.estudos.map((e) => [e.tipo, e]));
  return { ...r, por };
}

describe("robô tributário: os 4 estudos de uma empresa", () => {
  it("sempre devolve os 4 estudos, mesmo sem configuração (dizendo o que falta)", () => {
    const r = rodar(previsao("simples_nacional", meses(20000, 0), null));
    expect(r.estudos.map((e) => e.tipo)).toEqual(["regime", "fator_r", "imposto_pago_a_mais", "limite_simples"]);
    expect(r.por.regime.estado).toBe("faltam_dados");
    expect(r.por.regime.faltando[0]).toContain("configuração dos cálculos");
    expect(r.por.fator_r.estado).toBe("faltam_dados");
  });

  it("Fator R: folha baixa num serviço do Anexo V vira oportunidade, já descontando o INSS do pró-labore", () => {
    // Serviço de R$ 50 mil/mês com folha de R$ 5 mil (Fator R 10%)
    const r = rodar(previsao("simples_nacional", meses(0, 50000, 5000), { anexo_servicos: "V", fator_r: true, pro_labore: 5000 }));
    const f = r.por.fator_r;
    expect(f.estado).toBe("oportunidade");
    expect(f.titulo).toMatch(/Aumentar o pró-labore em R\$ .* por mês pode economizar R\$ .* por ano/);
    const liquido = new Decimal(f.economia_anual!);
    expect(liquido.gt(1200)).toBe(true);
    // Pró-labore a mais por ano = 28% de R$ 600 mil − R$ 60 mil = R$ 108 mil; INSS 11% = R$ 11.880
    expect(f.detalhes.passos.find((p) => p.rotulo.startsWith("Pró-labore a mais para chegar"))?.valor).toBe("R$ 108.000,00");
    expect(f.detalhes.passos.find((p) => p.rotulo.startsWith("INSS do sócio"))?.valor).toBe("R$ 11.880,00");
  });

  it("Fator R: acima de 28% fica no Anexo III; entre 28% e 30% vira alerta", () => {
    expect(rodar(previsao("simples_nacional", meses(0, 50000, 20000), { anexo_servicos: "V", fator_r: true })).por.fator_r.estado).toBe("nada_a_fazer");
    const perto = rodar(previsao("simples_nacional", meses(0, 50000, 14500), { anexo_servicos: "V", fator_r: true })).por.fator_r;
    expect(perto.estado).toBe("alerta");
    expect(perto.titulo).toContain("perto do limite");
  });

  it("Fator R: sem folha diz o que falta; fora do Simples não se aplica", () => {
    const sem = rodar(previsao("simples_nacional", meses(0, 50000), { anexo_servicos: "V", fator_r: true, pro_labore: 0 })).por.fator_r;
    expect(sem.estado).toBe("faltam_dados");
    expect(sem.faltando[0]).toContain("folha");
    expect(rodar(previsao("lucro_presumido", meses(0, 50000))).por.fator_r.estado).toBe("nada_a_fazer");
  });

  it("imposto pago a mais: soma os achados do auditor e separa os últimos 12 meses", () => {
    const achados: AchadoAuditor[] = [
      { regra: "monofasico_pis", titulo: "PIS/Cofins monofásico no DAS", competencia: "2026-08-01", valor: "1500.00", situacao: "novo", confianca: "alta" },
      { regra: "monofasico_pis", titulo: "PIS/Cofins monofásico no DAS", competencia: "2024-03-01", valor: "2500.00", situacao: "confirmado", confianca: "alta" },
    ];
    const a = rodar(previsao("simples_nacional", meses(20000, 0)), { achados }).por.imposto_pago_a_mais;
    expect(a.estado).toBe("oportunidade");
    expect(a.valor_unico).toBe("4000.00");
    expect(a.economia_anual).toBe("1500.00");
    expect(a.titulo).toBe("Imposto pago a mais: R$ 4.000,00 para recuperar");
  });

  it("imposto pago a mais: sem análise recente, o robô pede o auditor", () => {
    const nunca = rodar(previsao("simples_nacional", meses(20000, 0)), { ultima_execucao: null });
    expect(nunca.por.imposto_pago_a_mais.estado).toBe("faltam_dados");
    expect(nunca.pedirAuditor).toBe(true);
    expect(rodar(previsao("simples_nacional", meses(20000, 0)), { ultima_execucao: "2026-08-01T10:00:00Z" }).pedirAuditor).toBe(true);
    expect(rodar(previsao("simples_nacional", meses(20000, 0))).pedirAuditor).toBe(false);
    expect(rodar(previsao("simples_nacional", meses(20000, 0)), { tem_notas: false, ultima_execucao: null }).pedirAuditor).toBe(false);
  });

  it("limite do Simples: projeta o ano e avisa o sublimite e o limite", () => {
    expect(rodar(previsao("simples_nacional", meses(100000, 0))).por.limite_simples.estado).toBe("nada_a_fazer");
    // R$ 320 mil/mês: projeção de R$ 3,84 milhões no ano (acima do sublimite)
    const sub = rodar(previsao("simples_nacional", meses(320000, 0))).por.limite_simples;
    expect(sub.estado).toBe("alerta");
    expect(sub.titulo).toMatch(/sublimite/);
    // R$ 450 mil/mês: em outubro já soma R$ 4,5 milhões; passa de R$ 4,8 milhões em novembro
    const teto = rodar(previsao("simples_nacional", meses(450000, 0))).por.limite_simples;
    expect(teto.estado).toBe("alerta");
    expect(teto.titulo).toBe("Pode passar do limite do Simples em novembro de 2026");
    expect(rodar(previsao("lucro_real", meses(450000, 0))).por.limite_simples.estado).toBe("nada_a_fazer");
  });

  it("regime: com a configuração e a receita, compara e explica a conta", () => {
    const r = rodar(previsao("simples_nacional", meses(0, 50000, 5000), { anexo_servicos: "V", fator_r: false, margem_lucro: 20 })).por.regime;
    expect(["oportunidade", "nada_a_fazer", "faltam_dados"]).toContain(r.estado);
    expect(r.detalhes.passos[0].rotulo).toBe("Período");
    expect(r.detalhes.passos.some((p) => p.rotulo.startsWith("Simples Nacional (atual)"))).toBe(true);
    expect(r.detalhes.links[0].href).toBe(`/e/${EMPRESA}/calculos/comparativo?ate=2026-10`);
    // Sem receita: falta a receita
    expect(rodar(previsao("simples_nacional", meses(0, 0))).por.regime.estado).toBe("faltam_dados");
  });
});
