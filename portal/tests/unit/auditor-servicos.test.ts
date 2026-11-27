import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { auditarServicos, issEfetivoSimples, retencoesFederais, type MesSimplesServicos, type NotaServico } from "@/lib/auditor-fiscal/servicos";

const MES = "2026-09-01";
let seq = 0;
function nota(tributos: Record<string, string>, valor = "10000.00", extra: Partial<NotaServico> = {}): NotaServico {
  seq++;
  return {
    id: `n${seq}`,
    documento_id: `d${seq}`,
    numero: String(seq),
    modelo: "nfse_nacional",
    data: "2026-09-15T10:00:00-03:00",
    competencia: MES,
    operacao: "saida",
    valor,
    liquido: valor,
    tributos,
    contraparte_documento: "98765432000198",
    contraparte: "TOMADOR EXEMPLO (FICTICIO)",
    ...extra,
  };
}

const simplesIII: MesSimplesServicos = {
  rbt12: new Decimal("300000.00"),
  anexo: "III",
  anexoInformado: true,
  fatorREstimado: false,
  mesesSemDados: [],
  observacao: null,
};

function rodar(notas: NotaServico[], regime = "simples_nacional", s: MesSimplesServicos | null = simplesIII) {
  return auditarServicos({ inicio: MES, fim: MES, regimeDoMes: () => regime, simples: () => s, inicioAtividade: null, notas });
}

describe("Simples Nacional — ISS dos anexos de serviço", () => {
  it("calcula a parte do ISS na alíquota efetiva (Anexo III, 2ª faixa)", () => {
    const ef = issEfetivoSimples("III", new Decimal("300000"))!;
    // (300.000 × 11,2% − 9.360) ÷ 300.000 = 8,08%; ISS = 32% → 2,5856%
    expect(ef.efetiva.toFixed(4)).toBe("0.0808");
    expect(ef.iss!.times(100).toFixed(4)).toBe("2.5856");
  });
  it("limita o ISS efetivo a 5% (Anexo IV, 5ª faixa)", () => {
    const ef = issEfetivoSimples("IV", new Decimal("3500000"))!;
    expect(ef.iss!.toFixed(4)).toBe("0.0500");
  });
  it("na 6ª faixa o ISS fica fora do DAS", () => {
    expect(issEfetivoSimples("III", new Decimal("4000000"))!.iss).toBeNull();
  });
});

describe("retenções federais da NFS-e", () => {
  it("usa o total de retenções da nota quando existe (tira o ISS retido, o IR e o INSS)", () => {
    const r = retencoesFederais(nota({ ret_irrf: "150.00", total_ret: "1115.00", iss: "500.00", tp_ret_iss: "2" }));
    expect(r.irrf.toFixed(2)).toBe("150.00");
    expect(r.csrf.toFixed(2)).toBe("465.00");
  });
  it("leiaute antigo (tipo 1): PIS e Cofins retidos vinham em vPis/vCofins", () => {
    const r = retencoesFederais(nota({ tp_ret_pis_cofins: "1", pis: "65.00", cofins: "300.00", ret_csll: "100.00" }));
    expect(r.csrf.toFixed(2)).toBe("465.00");
  });
  it("NT 007/2026 (tipo 3): vRetCSLL já traz a soma", () => {
    const r = retencoesFederais(nota({ tp_ret_pis_cofins: "3", ret_csll: "465.00" }));
    expect(r.csrf.toFixed(2)).toBe("465.00");
  });
  it("ABRASF: PIS, Cofins e CSLL retidos em campos próprios", () => {
    const r = retencoesFederais(nota({ ret_pis: "65.00", ret_cofins: "300.00", ret_csll: "100.00", ret_irrf: "150.00" }, "10000.00", { modelo: "nfse_abrasf" }));
    expect(r.csrf.toFixed(2)).toBe("465.00");
    expect(r.irrf.toFixed(2)).toBe("150.00");
  });
});

describe("auditor de serviços", () => {
  it("ISS retido possivelmente pago de novo no DAS", () => {
    const achados = rodar([nota({ tp_ret_iss: "2", iss_retido: "sim", iss: "258.56", aliq_iss: "2.5856", base_iss: "10000.00", op_simp_nac: "3" })]);
    const a = achados.find((x) => x.regra === "iss_retido_simples")!;
    expect(a).toMatchObject({ chave: "iss_retido_simples:2026-09", tipo: "oportunidade", confianca: "alta", valor_base: "10000.00", valor_estimado: "258.56" });
    expect(a.referencias).toHaveLength(1);
    expect(a.fontes.map((f) => f.titulo).join(" ")).toContain("art. 21, § 4º, VII");
    // Alíquota igual à devida: sem achado de alíquota
    expect(achados.some((x) => x.regra.startsWith("iss_aliquota"))).toBe(false);
  });

  it("ISS fora do DAS (sublimite) ou imune não entra", () => {
    const achados = rodar([
      nota({ tp_ret_iss: "2", iss: "500.00", reg_ap_trib_sn: "2" }),
      nota({ tp_ret_iss: "2", iss: "500.00", trib_iss: "2" }),
    ]);
    expect(achados.some((x) => x.regra === "iss_retido_simples")).toBe(false);
  });

  it("alíquota da retenção acima e abaixo da efetiva do mês anterior", () => {
    const achados = rodar([
      nota({ tp_ret_iss: "2", iss: "500.00", aliq_iss: "5.00", base_iss: "10000.00" }),
      nota({ tp_ret_iss: "2", iss: "200.00", aliq_iss: "2.00", base_iss: "10000.00" }),
    ]);
    const acima = achados.find((x) => x.regra === "iss_aliquota_acima")!;
    const abaixo = achados.find((x) => x.regra === "iss_aliquota_abaixo")!;
    // (5% − 2,5856%) × 10.000 = 241,44; (2,5856% − 2%) × 10.000 = 58,56
    expect(acima).toMatchObject({ tipo: "oportunidade", valor_estimado: "241.44" });
    expect(abaixo).toMatchObject({ tipo: "risco", valor_estimado: "58.56" });
  });

  it("IR e contribuições retidos de empresa do Simples", () => {
    const achados = rodar([nota({ ret_irrf: "150.00", ret_csll: "465.00", tp_ret_pis_cofins: "3" })]);
    const a = achados.find((x) => x.regra === "retencao_federal_simples")!;
    expect(a).toMatchObject({ tipo: "oportunidade", confianca: "alta", valor_estimado: "615.00" });
    expect(a.fontes.map((f) => f.titulo).join(" ")).toMatch(/765\/2007.*10\.833\/2003/);
  });

  it("INSS retido: devido no Anexo IV, indevido nos outros anexos", () => {
    const comInss = () => [nota({ ret_cp: "1100.00" })];
    expect(rodar(comInss()).find((x) => x.regra === "inss_retido_simples")).toMatchObject({ confianca: "alta", valor_estimado: "1100.00" });
    expect(rodar(comInss(), "simples_nacional", { ...simplesIII, anexo: "IV" }).some((x) => x.regra === "inss_retido_simples")).toBe(false);
    expect(rodar(comInss(), "simples_nacional", { ...simplesIII, anexoInformado: false }).find((x) => x.regra === "inss_retido_simples")!.confianca).toBe(
      "conferir",
    );
  });

  it("regime na NFS-e diferente do cadastro", () => {
    const simples = rodar([nota({ op_simp_nac: "1" })]).find((x) => x.regra === "nfse_regime_divergente")!;
    expect(simples).toMatchObject({ tipo: "risco", valor_base: "10000.00" });
    expect(simples.titulo).toContain("não optante");
    const presumido = rodar([nota({ op_simp_nac: "3" })], "lucro_presumido").find((x) => x.regra === "nfse_regime_divergente")!;
    expect(presumido.resumo).toContain("Lucro Presumido");
  });

  it("empresa do Lucro Presumido não recebe achados do Simples", () => {
    const achados = rodar([nota({ tp_ret_iss: "2", iss: "500.00", ret_irrf: "150.00", ret_cp: "1100.00", op_simp_nac: "1" })], "lucro_presumido");
    expect(achados).toEqual([]);
  });

  it("MEI: retenções federais com confiança média e INSS a conferir", () => {
    const achados = rodar([nota({ ret_irrf: "15.00", ret_cp: "110.00", op_simp_nac: "2" }, "1000.00")], "mei", null);
    expect(achados.find((x) => x.regra === "retencao_federal_simples")!.confianca).toBe("media");
    expect(achados.find((x) => x.regra === "inss_retido_simples")!.confianca).toBe("conferir");
    expect(achados.some((x) => x.regra === "iss_retido_simples")).toBe(false);
  });

  it("notas de entrada (serviços tomados) não geram achados de prestador", () => {
    const achados = rodar([nota({ tp_ret_iss: "2", iss: "500.00", ret_irrf: "150.00" }, "10000.00", { operacao: "entrada" })]);
    expect(achados).toEqual([]);
  });
});
