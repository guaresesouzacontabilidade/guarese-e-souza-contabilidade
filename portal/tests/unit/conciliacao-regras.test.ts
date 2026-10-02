import { describe, expect, it } from "vitest";
import {
  analisarCombinacao,
  avaliarFinalizacao,
  competenciaPadrao,
  consolidarEscritorio,
  ordenarCandidatos,
  tratamentosPermitidos,
  tratamentoValido,
} from "@/lib/conciliacao/regras";

describe("tratamentosPermitidos", () => {
  it("segue as regras do banco para cada sentido", () => {
    expect(tratamentosPermitidos("0", "receber")).toEqual([]);
    expect(tratamentosPermitidos("5", "receber")).toEqual(["juros", "multa"]);
    expect(tratamentosPermitidos("5", "pagar")).toEqual(["juros", "multa", "taxa"]);
    expect(tratamentosPermitidos("-5", "receber")).toEqual(["desconto", "taxa", "parcial"]);
    expect(tratamentosPermitidos("-5", "pagar")).toEqual(["desconto", "parcial"]);
  });
});

describe("analisarCombinacao", () => {
  it("aceita valor exato sem tratamento", () => {
    const a = analisarCombinacao({ movimentos: [{ valor: "150.00" }], lancamentos: [{ tipo: "receber", aberto: "150.00" }], baixas: [] });
    expect(a.ok).toBe(true);
    expect(a.tipo).toBe("receber");
    expect(a.diferenca).toBe("0.00");
    expect(a.tratamentos).toEqual([]);
    expect(tratamentoValido(a, null)).toBe(true);
  });

  it("exige tratamento quando o pagamento difere do saldo em aberto", () => {
    const a = analisarCombinacao({ movimentos: [{ valor: "-102.50" }], lancamentos: [{ tipo: "pagar", aberto: "100.00" }], baixas: [] });
    expect(a.ok).toBe(true);
    expect(a.caixa).toBe("102.50");
    expect(a.diferenca).toBe("2.50");
    expect(a.tratamentos).toEqual(["juros", "multa", "taxa"]);
    expect(tratamentoValido(a, null)).toBe(false);
    expect(tratamentoValido(a, "desconto")).toBe(false);
    expect(tratamentoValido(a, "juros")).toBe(true);
  });

  it("soma vários lançamentos para uma movimentação sem erro de ponto flutuante", () => {
    const a = analisarCombinacao({
      movimentos: [{ valor: "0.30" }],
      lancamentos: [
        { tipo: "receber", aberto: "0.10" },
        { tipo: "receber", aberto: "0.20" },
      ],
      baixas: [],
    });
    expect(a.ok).toBe(true);
    expect(a.diferenca).toBe("0.00");
  });

  it("recusa sentidos misturados", () => {
    expect(analisarCombinacao({ movimentos: [{ valor: "10" }, { valor: "-10" }], lancamentos: [], baixas: [] }).erro).toMatch(/misture/);
    expect(analisarCombinacao({ movimentos: [{ valor: "10" }], lancamentos: [{ tipo: "pagar", aberto: "10" }], baixas: [] }).erro).toMatch(/a receber/);
  });

  it("recusa N movimentações com N lançamentos", () => {
    const a = analisarCombinacao({
      movimentos: [{ valor: "10" }, { valor: "10" }],
      lancamentos: [
        { tipo: "receber", aberto: "10" },
        { tipo: "receber", aberto: "10" },
      ],
      baixas: [],
    });
    expect(a.ok).toBe(false);
  });

  it("baixas sozinhas precisam conferir exatamente", () => {
    expect(analisarCombinacao({ movimentos: [{ valor: "-50" }], lancamentos: [], baixas: [{ tipo: "pagar", total: "50" }] }).ok).toBe(true);
    const a = analisarCombinacao({ movimentos: [{ valor: "-50" }], lancamentos: [], baixas: [{ tipo: "pagar", total: "49" }] });
    expect(a.ok).toBe(false);
    expect(a.erro).toMatch(/1,00/);
  });

  it("exige seleção", () => {
    expect(analisarCombinacao({ movimentos: [], lancamentos: [], baixas: [] }).ok).toBe(false);
    expect(analisarCombinacao({ movimentos: [{ valor: "1" }], lancamentos: [], baixas: [] }).ok).toBe(false);
  });
});

describe("ordenarCandidatos", () => {
  it("filtra pelo sentido e ordena por valor e depois por data", () => {
    const c = [
      { id: "a", tipo: "pagar" as const, aberto: "100.00", vencimento: "2026-09-01" },
      { id: "b", tipo: "pagar" as const, aberto: "99.00", vencimento: "2026-09-10" },
      { id: "c", tipo: "pagar" as const, aberto: "100.00", vencimento: "2026-09-09" },
      { id: "d", tipo: "receber" as const, aberto: "100.00", vencimento: "2026-09-10" },
    ];
    expect(ordenarCandidatos({ valor: "-100.00", data: "2026-09-10" }, c).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("competenciaPadrao", () => {
  it("usa o mês da pendência mais antiga ou o mês anterior", () => {
    expect(competenciaPadrao("2026-07-15", "2026-10-01")).toBe("2026-07-01");
    expect(competenciaPadrao(null, "2026-01-01")).toBe("2025-12-01");
  });
});

describe("avaliarFinalizacao", () => {
  it("impede com pendências e avisa diferenças de saldo", () => {
    const r = avaliarFinalizacao(2, [{ conta_nome: "Banco", saldo_extrato: 100, diferenca: 0, movimentos_pendentes: 2 }]);
    expect(r.pode).toBe(false);
    expect(r.avisos).toEqual([]);
    const r2 = avaliarFinalizacao(0, [
      { conta_nome: "Banco", saldo_extrato: 100, diferenca: -1.5, movimentos_pendentes: 0 },
      { conta_nome: "Caixa", saldo_extrato: null, diferenca: null, movimentos_pendentes: 0 },
    ]);
    expect(r2.pode).toBe(true);
    expect(r2.exigeJustificativa).toBe(true);
    expect(r2.avisos[0]).toContain("-1,50");
  });
});

describe("consolidarEscritorio", () => {
  it("agrega pendências, sugestões e última conciliação por empresa", () => {
    const linhas = consolidarEscritorio(
      [
        { id: "e1", nome: "Alfa" },
        { id: "e2", nome: "Beta" },
      ],
      [
        { empresa_id: "e1", data: "2026-09-10", valor: -10.1 },
        { empresa_id: "e1", data: "2026-08-02", valor: "20.20" },
        { empresa_id: "x", data: "2026-01-01", valor: 1 },
      ],
      [{ empresa_id: "e1" }, { empresa_id: "e2" }, { empresa_id: "e2" }],
      [
        { empresa_id: "e2", confirmada_em: "2026-09-01T10:00:00Z" },
        { empresa_id: "e2", confirmada_em: "2026-09-20T10:00:00Z" },
      ],
      [{ empresa_id: "e1" }],
    );
    const e1 = linhas.find((l) => l.id === "e1")!;
    const e2 = linhas.find((l) => l.id === "e2")!;
    expect(e1).toMatchObject({ pendentes: 2, valorPendente: "30.30", maisAntiga: "2026-08-02", sugestoes: 1, contas: 1, ultimaConciliacao: null });
    expect(e2).toMatchObject({ pendentes: 0, sugestoes: 2, ultimaConciliacao: "2026-09-20T10:00:00Z", contas: 0 });
  });
});
