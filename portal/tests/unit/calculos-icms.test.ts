import { describe, expect, it } from "vitest";
import {
  calcularIcms,
  destinacaoPeloCfop,
  itemComSt,
  mudouDesdeConferencia,
  resultadoParaGuardar,
  tipoEntrada,
  type DadosIcms,
  type ItemEntradaDados,
  type NotaEntradaDados,
} from "@/lib/calculos/icms";
import { reducaoComplementacao, REGRAS_ICMS } from "@/lib/calculos/icms-regras";
import { calcularPrevisao, icmsNoDas, type DadosPrevisao, type MesDados, type ParametrosCalculo } from "@/lib/calculos/previsao";
import { somarMeses } from "@/lib/competencia";

const COMP = "2026-09-01";

function dados(regime: string, extra: Partial<DadosIcms> = {}, empresa: Partial<DadosIcms["empresa"]> = {}): DadosIcms {
  return {
    competencia: COMP,
    empresa: { nome: "Teste", uf: "TO", regime, contribuinte_icms: true, inscricao_estadual: true, ...empresa },
    gerenciar: true,
    detalhe: true,
    destinacao_padrao: "revenda",
    aliquota_interna: { uf: "TO", aliquota: 20, situacao: "conferida", fcp: null, base_legal: "Lei nº 1.287/2001, art. 27, II", fonte_url: null },
    saidas: [],
    saidas_totais: { notas: 0, nfce: 0, icms_st: 0, fcp: 0, difal_destino: 0, fcp_destino: 0, vendas_outro_estado_consumidor: 0 },
    entradas: [],
    fornecedores: {},
    leitura_antiga: 0,
    lancamentos: [],
    apuracao: null,
    anterior: null,
    sped: null,
    releitura_pendente: false,
    vencimentos: [],
    ...extra,
  };
}

let seq = 0;
function nota(uf: string, itens: Partial<ItemEntradaDados>[], extra: Partial<NotaEntradaDados> = {}): NotaEntradaDados {
  seq++;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    modelo: "55",
    numero: String(seq),
    serie: "1",
    data: "2026-09-10T10:00:00-03:00",
    emitente: `Fornecedor ${seq}`,
    emitente_documento: `1122233300${String(seq).padStart(4, "0")}`,
    emitente_uf: uf,
    propria: false,
    crt: "3",
    valor_total: itens.reduce((s, i) => s + Number(i.valor ?? 0), 0),
    valor_produtos: itens.reduce((s, i) => s + Number(i.valor ?? 0), 0),
    frete: 0,
    outros: 0,
    seguro: null,
    icms: itens.reduce((s, i) => s + Number(i.icms ?? 0), 0),
    leitura: 4,
    destinacao: null,
    itens: itens.map((i, k) => ({ n: k + 1, cfop: "6102", orig: "0", cst: "00", valor: 0, ...i })),
    ...extra,
  };
}

const linha = (r: ReturnType<typeof calcularIcms>, chave: string) => r.linhas.find((l) => l.chave === chave)?.valor.toFixed(2);

describe("ICMS: classificação das entradas", () => {
  it("tipo pelo CFOP da nota do fornecedor ou da própria empresa", () => {
    expect(tipoEntrada("6102")).toBe("compra");
    expect(tipoEntrada("5405")).toBe("compra");
    expect(tipoEntrada("2556")).toBe("compra");
    expect(tipoEntrada("6202")).toBe("devolucao");
    expect(tipoEntrada("1202")).toBe("devolucao");
    expect(tipoEntrada("6152")).toBe("transferencia");
    expect(tipoEntrada("6910")).toBe("outras");
    expect(tipoEntrada("5915")).toBe("outras");
    expect(tipoEntrada(null, "57")).toBe("frete");
  });

  it("destinação que o CFOP de entrada já informa", () => {
    expect(destinacaoPeloCfop("2556")).toBe("uso_consumo");
    expect(destinacaoPeloCfop("2551")).toBe("ativo");
    expect(destinacaoPeloCfop("2102")).toBe("revenda");
    expect(destinacaoPeloCfop("6102")).toBeNull();
  });

  it("mercadoria com ST ou monofásica", () => {
    expect(itemComSt({ n: 1, valor: 10, cst: "60" })).toBe(true);
    expect(itemComSt({ n: 1, valor: 10, cst: "61" })).toBe(true);
    expect(itemComSt({ n: 1, valor: 10, csosn: "500" })).toBe(true);
    expect(itemComSt({ n: 1, valor: 10, cst: "00", icms_st: "15.00" })).toBe(true);
    expect(itemComSt({ n: 1, valor: 10, cfop: "6403", cst: "00" })).toBe(true);
    expect(itemComSt({ n: 1, valor: 10, cfop: "6102", cst: "00" })).toBe(false);
  });

  it("redução da complementação do Tocantins por ano (Lei 1.303/2002, art. 1º-A)", () => {
    const to = REGRAS_ICMS.TO;
    expect(reducaoComplementacao(to, 2026)).toBe(75);
    expect(reducaoComplementacao(to, 2027)).toBe(50);
    expect(reducaoComplementacao(to, 2028)).toBe(25);
    expect(reducaoComplementacao(to, 2029)).toBe(0);
    expect(reducaoComplementacao(to, 2021)).toBeNull();
  });
});

describe("ICMS: Simples Nacional no Tocantins", () => {
  it("complementação de alíquota nas compras de outros estados para revenda (base reduzida em 75% em 2026)", () => {
    const r = calcularIcms(
      dados("simples_nacional", {
        entradas: [
          nota("SP", [{ valor: 1000, icms: 70, p_icms: 7 }]), // 7%: 1.000 × 25% × 13% = 32,50
          nota("GO", [{ valor: 1000, icms: 120, p_icms: 12 }]), // 12%: 1.000 × 25% × 8% = 20,00
          nota("GO", [{ valor: 500, orig: "1", icms: 20, p_icms: 4 }]), // importado 4%: 500 × 25% × 16% = 20,00
          nota("GO", [{ valor: 800, cst: "60" }]), // ST: fora
          nota("TO", [{ valor: 900, icms: 180 }]), // mesmo estado: fora
        ],
      }),
    );
    expect(r.modo).toBe("simples");
    expect(linha(r, "complementacao")).toBe("72.50");
    expect(r.linhas.find((l) => l.chave === "complementacao")?.vencimento).toBe("2026-10-09");
    expect(r.resumoEntradas.interestaduais).toBe(4);
    expect(linha(r, "icms_proprio")).toBeUndefined();
  });

  it("DIFAL do Simples: diferença simples entre as alíquotas (SP→TO 13%, GO→TO 8%)", () => {
    const r = calcularIcms(
      dados("simples_nacional", {
        entradas: [
          // GO (12%): 1.000 × (20% − 12%) = 80
          nota("GO", [{ valor: 1000, icms: 120, p_icms: 12 }], { destinacao: "uso_consumo" }),
          // SP, fornecedor do Simples (sem ICMS destacado): 500 × (20% − 7%) = 65
          nota("SP", [{ valor: 500, csosn: "102", cst: null }], { destinacao: "ativo", crt: "1" }),
        ],
      }),
    );
    expect(linha(r, "difal")).toBe("145.00");
    expect(linha(r, "complementacao")).toBeUndefined();
  });

  it("nota de SP com itens 2.102 e 2.556: complementação 3,25% e DIFAL 13%; importado a 4%: complementação 4%", () => {
    const r = calcularIcms(
      dados("simples_nacional", {
        entradas: [
          nota("SP", [
            { valor: 1000, icms: 70, p_icms: 7 }, // revenda (2.102): 1.000 × 25% × 13% = 32,50
            { valor: 200, icms: 14, p_icms: 7, destinacao: "uso_consumo" }, // uso e consumo (2.556): 200 × 13% = 26,00
            { valor: 400, icms: 16, p_icms: 4, orig: "2" }, // importado (4%): 400 × 25% × 16% = 16,00
          ]),
        ],
      }),
    );
    expect(linha(r, "complementacao")).toBe("48.50");
    expect(linha(r, "difal")).toBe("26.00");
  });

  it("destinação: item → nota → fornecedor → padrão da empresa", () => {
    const n1 = nota("GO", [{ valor: 1000, icms: 120 }, { valor: 1000, icms: 120, destinacao: "revenda" }], { destinacao: "uso_consumo" });
    const n2 = nota("GO", [{ valor: 1000, icms: 120 }]);
    const n3 = nota("GO", [{ valor: 1000, icms: 120 }]);
    const r = calcularIcms(
      dados("simples_nacional", { entradas: [n1, n2, n3], fornecedores: { [n2.emitente_documento!]: "uso_consumo" }, destinacao_padrao: "revenda" }),
    );
    const [c1, c2, c3] = r.notas;
    expect(c1.itens.map((i) => [i.destinacao, i.origemDestinacao])).toEqual([
      ["uso_consumo", "nota"],
      ["revenda", "item"],
    ]);
    expect(c1.destinacao).toBeNull();
    expect(c2.itens[0]).toMatchObject({ destinacao: "uso_consumo", origemDestinacao: "fornecedor" });
    expect(c3.itens[0]).toMatchObject({ destinacao: "revenda", origemDestinacao: "padrao" });
    // DIFAL 80 + 80 (uso e consumo, 8%) e complementação 20 + 20 (revenda)
    expect(linha(r, "difal")).toBe("160.00");
    expect(linha(r, "complementacao")).toBe("40.00");
  });

  it("frete e despesas: por item na leitura atual; rateados nas notas lidas antes", () => {
    const atual = nota("GO", [{ valor: 900, frete: 100, icms: 120 }]);
    const antiga = nota("GO", [{ valor: 600, icms: 72 }, { valor: 300, icms: 36 }], { leitura: 3, frete: 90, outros: 10 });
    const r = calcularIcms(dados("simples_nacional", { entradas: [atual, antiga] }));
    expect(r.notas[0].itens[0].valorOperacao.toFixed(2)).toBe("1000.00");
    expect(r.notas[1].itens.map((i) => i.valorOperacao.toFixed(2))).toEqual(["666.67", "333.33"]);
    expect(r.notas[1].itens[0].rateado).toBe(true);
    // (1.000 + 1.000) × 25% × 8%
    expect(linha(r, "complementacao")).toBe("40.00");
  });

  it("2027: redução de 50% na base da complementação", () => {
    const r = calcularIcms({ ...dados("simples_nacional", { entradas: [nota("GO", [{ valor: 1000, icms: 120 }])] }), competencia: "2027-03-01" });
    expect(linha(r, "complementacao")).toBe("40.00");
  });

  it("nota emitida pela própria empresa (filial) e bonificação não entram; bonificação marcada como revenda entra", () => {
    const filial = nota("GO", [{ valor: 1000, icms: 120 }], { propria: true });
    const bonif = nota("GO", [{ valor: 1000, icms: 120, cfop: "6910" }]);
    const bonifRevenda = nota("GO", [{ valor: 1000, icms: 120, cfop: "6910" }], { destinacao: "revenda" });
    const r = calcularIcms(dados("simples_nacional", { entradas: [filial, bonif, bonifRevenda] }));
    expect(r.notas[1].itens[0].destinacao).toBe("nao_se_aplica");
    expect(linha(r, "complementacao")).toBe("20.00");
  });

  it("aviso de possível ST na entrada (CEST sem retenção)", () => {
    const r = calcularIcms(dados("simples_nacional", { entradas: [nota("GO", [{ valor: 100, icms: 12, cest: "1700100" }])] }));
    expect(r.resumoEntradas.possivelSt).toBe(1);
    expect(r.avisos.some((a) => a.includes("CEST"))).toBe(true);
  });

  it("outro estado sem regras cadastradas: avisa e não calcula complementação", () => {
    const r = calcularIcms(dados("simples_nacional", { entradas: [nota("SP", [{ valor: 1000, icms: 120 }])] }, { uf: "GO" }));
    expect(linha(r, "complementacao")).toBeUndefined();
    expect(r.avisos.some((a) => a.includes("GO ainda não estão cadastradas"))).toBe(true);
  });
});

describe("ICMS: regime normal (apuração própria)", () => {
  const saidas = [
    { cfop: "5102", notas: 3, valor: 10000, base: 10000, icms: 2000 },
    { cfop: "5929", notas: 1, valor: 500, base: 500, icms: 100 },
  ];

  it("débitos − créditos, com uso e consumo, ST, crédito do Simples e devolução", () => {
    const r = calcularIcms(
      dados("lucro_presumido", {
        saidas,
        entradas: [
          nota("TO", [{ valor: 5000, icms: 1000, cfop: "5102" }]), // revenda: crédito 1.000
          nota("TO", [{ valor: 1000, icms: 200, cfop: "5102" }], { destinacao: "uso_consumo" }), // sem crédito
          nota("TO", [{ valor: 1000, icms: 0, cst: "60", cfop: "5405" }]), // ST: sem crédito
          nota("TO", [{ valor: 2000, cst: null, csosn: "101", cred_sn: "50.00", cfop: "5102" }], { crt: "1" }), // crédito do Simples 50
          nota("TO", [{ valor: 300, icms: 60, cfop: "5202" }]), // devolução de venda: crédito 60
        ],
        lancamentos: [{ id: "l1", tipo: "outro_credito", descricao: "CIAP 1/48", valor: 40, observacao: null }],
        anterior: { conferida: true, saldo_credor_transportar: 100 },
      }),
    );
    expect(r.modo).toBe("normal");
    const p = r.propria!;
    expect(p.debitos.toFixed(2)).toBe("2000.00"); // 5.929 fora
    expect(p.creditos.toFixed(2)).toBe("1110.00");
    expect(p.saldoAnterior.toFixed(2)).toBe("100.00");
    expect(p.origemSaldo).toBe("mes_anterior");
    // 2.000 − (1.110 + 40 + 100) = 750
    expect(p.aRecolher.toFixed(2)).toBe("750.00");
    expect(linha(r, "icms_proprio")).toBe("750.00");
    expect(r.linhas.find((l) => l.chave === "icms_proprio")?.vencimento).toBe("2026-10-09");
    expect(p.creditosPorGrupo.find((g) => g.rotulo.startsWith("Uso e consumo"))?.icms.toFixed(2)).toBe("200.00");
  });

  it("saldo credor passa para o mês seguinte; saldo informado prevalece", () => {
    const r = calcularIcms(
      dados("lucro_real", {
        saidas: [{ cfop: "5102", notas: 1, valor: 1000, base: 1000, icms: 200 }],
        entradas: [nota("TO", [{ valor: 2000, icms: 400, cfop: "5102" }])],
        apuracao: {
          saldo_credor_anterior: 50, saldo_observacao: null, conferida_em: null, conferida_por: null, a_recolher: null,
          saldo_credor_transportar: null, total_guias: null, resultado: null, reaberta_em: null, motivo_reabertura: null,
        },
        anterior: { conferida: true, saldo_credor_transportar: 999 },
      }),
    );
    expect(r.propria!.origemSaldo).toBe("informado");
    expect(r.propria!.saldoCredorTransportar.toFixed(2)).toBe("250.00");
    expect(r.propria!.aRecolher.toFixed(2)).toBe("0.00");
    expect(linha(r, "icms_proprio")).toBeUndefined();
  });

  it("DIFAL de uso e consumo também no regime normal; ICMS-ST e DIFAL das vendas", () => {
    const r = calcularIcms(
      dados("lucro_presumido", {
        entradas: [nota("SP", [{ valor: 1000, icms: 70, p_icms: 7 }], { destinacao: "uso_consumo" })],
        saidas_totais: { notas: 2, nfce: 0, icms_st: 35.5, fcp: 0, difal_destino: 80, fcp_destino: 20, vendas_outro_estado_consumidor: 1 },
        lancamentos: [{ id: "x", tipo: "guia_extra", descricao: "ICMS-ST na entrada (MVA)", valor: 12.34, observacao: null }],
      }),
    );
    // (1.000 − 70) ÷ 0,8 = 1.162,50; × 20% = 232,50 − 70 = 162,50
    expect(linha(r, "difal")).toBe("162.50");
    expect(linha(r, "st_vendas")).toBe("35.50");
    expect(linha(r, "difal_vendas")).toBe("100.00");
    expect(linha(r, "extra:x")).toBe("12.34");
    expect(r.totalGuias.toFixed(2)).toBe("310.34");
  });

  it("compara com a EFD (E110) e aponta diferenças", () => {
    const r = calcularIcms(
      dados("lucro_presumido", {
        saidas: [{ cfop: "5102", notas: 1, valor: 4775, base: 4775, icms: 955 }],
        anterior: { conferida: true, saldo_credor_transportar: 0 },
        sped: {
          arquivo_id: "s",
          nome: "efd.txt",
          conferido_em: null,
          apuracao: {
            debitos: "693.00", ajustes_debito: "0.00", estornos_credito: "0.00", creditos: "0.00", ajustes_credito: "0.00", estornos_debito: "0.00",
            saldo_credor_anterior: "0.00", saldo_devedor: "693.00", deducoes: "0.00", a_recolher: "693.00", saldo_credor_transportar: "0.00", extra_apuracao: "0.00",
          },
        },
      }),
    );
    const debitos = r.comparacaoSped!.find((c) => c.rotulo === "Débitos")!;
    expect(debitos.diferente).toBe(true);
    expect(r.comparacaoSped!.find((c) => c.rotulo === "Créditos")!.diferente).toBe(false);
  });

  it("conferência: resultado guardado e detecção de mudança", () => {
    const d = dados("lucro_presumido", { saidas: [{ cfop: "5102", notas: 1, valor: 1000, base: 1000, icms: 200 }], anterior: { conferida: true, saldo_credor_transportar: 0 } });
    const r = calcularIcms(d);
    const g = resultadoParaGuardar(r);
    expect(g).toMatchObject({ a_recolher: "200.00", total_guias: "200.00", saldo_credor_transportar: "0.00" });
    expect(mudouDesdeConferencia(r, g)).toBe(false);
    const r2 = calcularIcms({ ...d, saidas: [{ cfop: "5102", notas: 2, valor: 2000, base: 2000, icms: 400 }] });
    expect(mudouDesdeConferencia(r2, g)).toBe(true);
  });

  it("não contribuinte e regime sem apuração", () => {
    expect(calcularIcms(dados("lucro_real", {}, { contribuinte_icms: false })).modo).toBe("nao_contribuinte");
    expect(calcularIcms(dados("imune_isenta")).modo).toBe("sem_regime");
  });
});

describe("ICMS na previsão de impostos", () => {
  const PARAMS: ParametrosCalculo = {
    inicio_atividade: null, mei_atividade: null, anexo_mercadorias: "I", anexo_servicos: "III", fator_r: false,
    presuncao_irpj_mercadorias: 8, presuncao_irpj_servicos: 32, presuncao_csll_mercadorias: 12, presuncao_csll_servicos: 32,
    acrescimo_lc224: true, creditos_pis_cofins: true, aliquota_iss: null, calcular_icms: true, calcular_ipi: false,
    rat: 2, fap: 1, terceiros: 5.8, pro_labore: 0, socios_pro_labore: 1,
  };
  function mes(competencia: string, v: Partial<MesDados> = {}): MesDados {
    return {
      competencia, vendas: 0, vendas_st: 0, icms_vendas: 0, servicos_nfe: 0, devolucoes: 0, icms_devolucoes: 0, compras: 0, icms_compras: 0,
      servicos: 0, servicos_retido: 0, iss_destacado: 0, servicos_sem_iss: 0, iss_retido: 0, icms_debito: 0, icms_credito: 0,
      ipi_debito: 0, ipi_credito: 0, notas_saida: 0, notas_entrada: 0, informado: null, ...v,
    };
  }
  function previsao(regime: string, atual: Partial<MesDados>, extra: Partial<DadosPrevisao> = {}): DadosPrevisao {
    const meses: MesDados[] = [];
    for (let i = -12; i < 0; i++) meses.push(mes(somarMeses(COMP, i), { informado: { receita_mercadorias: 50000, receita_servicos: 0, folha_fator_r: null, observacao: null } }));
    meses.push(mes(COMP, atual));
    return {
      competencia: COMP,
      empresa: { nome: "T", regime, lucro_real_apuracao: null, contribuinte_icms: true, contribuinte_iss: false, tem_empregados: false, tem_pro_labore: false, uf: "TO" },
      parametros: PARAMS, meses, checklist: { itens: 1, obrigatorios: 1, faltantes: [] }, colaboradores: [], ajustes: [], vencimentos: [], guias_publicadas: 0,
      ...extra,
    };
  }

  it("Simples: guias de ICMS da apuração entram na previsão", () => {
    const r = calcularIcms(dados("simples_nacional", { entradas: [nota("GO", [{ valor: 1000, icms: 120 }])] }));
    const p = calcularPrevisao(previsao("simples_nacional", { vendas: 40000, notas_saida: 10 }, { icms: r.linhas }));
    expect(p.linhas.find((l) => l.chave === "icms:complementacao")?.valor.toFixed(2)).toBe("20.00");
    expect(p.linhas.some((l) => l.chave === "das")).toBe(true);
  });

  it("regime normal: a apuração substitui a conta simples débitos − créditos", () => {
    const r = calcularIcms(dados("lucro_presumido", { saidas: [{ cfop: "5102", notas: 1, valor: 1000, base: 1000, icms: 200 }], anterior: { conferida: true, saldo_credor_transportar: 30 } }));
    const p = calcularPrevisao(previsao("lucro_presumido", { vendas: 1000, icms_vendas: 200, icms_debito: 200, notas_saida: 1 }, { icms: r.linhas }));
    expect(p.linhas.find((l) => l.chave === "icms:icms_proprio")?.valor.toFixed(2)).toBe("170.00");
    expect(p.linhas.some((l) => l.chave === "icms")).toBe(false);
    // Sem a apuração: conta simples (como antes)
    const antiga = calcularPrevisao(previsao("lucro_presumido", { vendas: 1000, icms_vendas: 200, icms_debito: 200, notas_saida: 1 }));
    expect(antiga.linhas.find((l) => l.chave === "icms")?.valor.toFixed(2)).toBe("200.00");
  });

  it("ICMS dentro do DAS (parcela do ICMS no Anexo I)", () => {
    // RBT12 600.000 → 3ª faixa: (600.000 × 9,5% − 13.860) ÷ 600.000 = 7,19%; ICMS 33,5%
    const r = icmsNoDas(previsao("simples_nacional", { vendas: 40000, notas_saida: 10 }), COMP)!;
    expect(r.valor.toFixed(2)).toBe("963.46");
  });
});

describe("ICMS: regra do fornecedor sem o CNPJ na tela", () => {
  it("usa a destinação do fornecedor que vem na própria nota", () => {
    const n = nota("GO", [{ valor: 1000, icms: 120 }], { emitente_documento: null, emitente: null, destinacao_fornecedor: "uso_consumo" });
    const r = calcularIcms(dados("simples_nacional", { entradas: [n] }));
    expect(r.notas[0].itens[0]).toMatchObject({ destinacao: "uso_consumo", origemDestinacao: "fornecedor" });
    expect(linha(r, "difal")).toBe("80.00");
  });
});

describe("ICMS: NF-e só em resumo (sem o XML completo)", () => {
  it("lista, soma e avisa que ficam fora do cálculo", () => {
    const r = calcularIcms(
      dados("simples_nacional", {
        sem_xml: [
          // 35 = SP (outro estado); 17 = TO
          { chave: `3526094931941100218755001000823700100000001${"0"}`, emitente: "RFG", emitente_documento: "49319411002187", data: "2026-09-21T10:00:00-03:00", valor: "6574.64", ciencia: false, confirmacao_pedida: true, confirmada: true },
          { chave: `1726090338076300117555001000012345100000001${"0"}`, emitente: "Refrescos", emitente_documento: "03380763001175", data: "2026-09-12T10:00:00-03:00", valor: 27.85, ciencia: false, confirmacao_pedida: true, confirmada: false },
        ],
      }),
    );
    expect(r.semXml.notas).toHaveLength(2);
    expect(r.semXml.valor.toFixed(2)).toBe("6602.49");
    expect(r.semXml.outroEstado).toBe(1);
    expect(r.semXml.notas[0]).toMatchObject({ uf: "SP", outroEstado: true, numero: "823700" });
    expect(r.avisos[0]).toContain("2 NF-e de entrada do mês ainda estão só em resumo");
    expect(r.totalGuias.toFixed(2)).toBe("0.00");
  });
});
