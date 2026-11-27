import { describe, expect, it } from "vitest";
import { aliquotaInterestadual, diferencialAliquotas, textoAliquota, textoVencimento } from "@/lib/fiscal/icms-estados";

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const SUL_SUDESTE = ["MG", "PR", "RJ", "RS", "SC", "SP"];

describe("alíquota interestadual (Resoluções do Senado nº 22/1989 e nº 13/2012)", () => {
  it("7% do Sul e do Sudeste (exceto ES) para N, NE, CO e ES", () => {
    expect(aliquotaInterestadual("SP", "TO")).toBe(7);
    expect(aliquotaInterestadual("PR", "DF")).toBe(7);
    expect(aliquotaInterestadual("RS", "BA")).toBe(7);
    expect(aliquotaInterestadual("MG", "ES")).toBe(7);
  });

  it("12% nas demais operações entre estados", () => {
    expect(aliquotaInterestadual("TO", "SP")).toBe(12);
    expect(aliquotaInterestadual("ES", "SP")).toBe(12);
    expect(aliquotaInterestadual("SP", "RJ")).toBe(12);
    expect(aliquotaInterestadual("GO", "TO")).toBe(12);
    expect(aliquotaInterestadual("AM", "PA")).toBe(12);
  });

  it("4% para mercadoria importada e nada na operação interna", () => {
    expect(aliquotaInterestadual("SP", "TO", true)).toBe(4);
    expect(aliquotaInterestadual("TO", "SP", true)).toBe(4);
    expect(aliquotaInterestadual("TO", "TO")).toBeNull();
    expect(aliquotaInterestadual(" to", "TO ")).toBeNull();
  });

  it("matriz completa: só 7% ou 12% entre estados diferentes", () => {
    let setes = 0;
    for (const o of UFS) {
      for (const d of UFS) {
        const a = aliquotaInterestadual(o, d);
        if (o === d) expect(a).toBeNull();
        else expect([7, 12]).toContain(a);
        if (a === 7) setes += 1;
      }
    }
    // 6 estados de origem × 21 destinos (N, NE, CO e ES)
    expect(setes).toBe(SUL_SUDESTE.length * (UFS.length - SUL_SUDESTE.length));
  });
});

describe("diferencial e textos", () => {
  it("diferencial = interna do destino + fundo de pobreza - interestadual", () => {
    expect(diferencialAliquotas(20, null, 7)).toBe(13);
    expect(diferencialAliquotas(20, 2, 12)).toBe(10);
    expect(diferencialAliquotas(20.5, 1, 4)).toBe(17.5);
    expect(diferencialAliquotas(12, null, 12)).toBe(0);
  });

  it("formata alíquota e vencimento", () => {
    expect(textoAliquota(20.5)).toBe("20,5%");
    expect(textoAliquota(18)).toBe("18%");
    expect(textoAliquota(null)).toBe("—");
    expect(textoVencimento({ vencimento_situacao: "conferido", vencimento_dia: 9, vencimento_ajuste: "postergar" })).toBe(
      "Dia 9 do mês seguinte (sem expediente, passa para o dia útil seguinte)",
    );
    expect(textoVencimento({ vencimento_situacao: "a_conferir", vencimento_dia: null, vencimento_ajuste: null })).toBe("A conferir");
    expect(textoVencimento({ vencimento_situacao: "calendario", vencimento_dia: null, vencimento_ajuste: null })).toBe(
      "Datas do calendário fiscal do estado",
    );
  });
});
