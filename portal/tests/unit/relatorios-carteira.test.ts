import { describe, expect, it } from "vitest";
import { contarPorEmpresaMes, entregaChecklist, pendenciasChecklist, percentualInteiro, resumirCarteira } from "@/lib/relatorios/carteira";

describe("financeiro da carteira", () => {
  it("resume em aberto, vencidos, próximos 7 dias e sugeridos por empresa", () => {
    const r = resumirCarteira(
      [
        { empresa_id: "a", tipo: "receber", data_vencimento: "2026-09-30", valor_previsto: "100.10", valor_baixado: "0.10" },
        { empresa_id: "a", tipo: "receber", data_vencimento: "2026-10-05", valor_previsto: 0.1, valor_baixado: 0 },
        { empresa_id: "a", tipo: "pagar", data_vencimento: "2026-10-09", valor_previsto: 0.2, valor_baixado: 0 },
        { empresa_id: "a", tipo: "pagar", data_vencimento: "2026-10-10", valor_previsto: 50, valor_baixado: 0 },
        { empresa_id: "a", tipo: "pagar", data_vencimento: "2026-09-01", valor_previsto: 999, valor_baixado: 0, cartao: true },
        { empresa_id: "b", tipo: "pagar", data_vencimento: "2026-09-01", valor_previsto: 10, valor_baixado: 10 },
      ],
      [{ empresa_id: "a" }, { empresa_id: "c" }, { empresa_id: "c" }],
      "2026-10-02",
    );
    const a = r.get("a")!;
    expect(a.receberAberto.toFixed(2)).toBe("100.10");
    expect(a.receberVencido.toFixed(2)).toBe("100.00");
    expect(a.receber7.toFixed(2)).toBe("0.10");
    expect(a.pagarAberto.toFixed(2)).toBe("50.20");
    expect(a.pagar7.toFixed(2)).toBe("0.20");
    expect(a.pagarVencido.isZero()).toBe(true);
    expect(a.titulosVencidos).toBe(1);
    expect(a.sugeridos).toBe(1);
    expect(r.has("b")).toBe(false);
    expect(r.get("c")!.sugeridos).toBe(2);
  });
});

describe("relatórios do escritório", () => {
  const meses = ["2026-08-01", "2026-09-01"];
  it("conta documentos por empresa e competência", () => {
    const m = contarPorEmpresaMes(
      [
        { empresa_id: "a", competencia: "2026-08-01" },
        { empresa_id: "a", competencia: "2026-08-01" },
        { empresa_id: "a", competencia: "2026-09-01" },
        { empresa_id: "b", competencia: "2026-07-01" },
      ],
      meses,
    );
    expect(m.get("a")).toEqual([2, 1]);
    expect(m.has("b")).toBe(false);
  });
  it("calcula a entrega do checklist (somente obrigatórios)", () => {
    const item = (empresa_id: string, competencia: string, status: string, obrigatorio = true) => ({ empresa_id, competencia, status, obrigatorio, prazo: "2026-09-10" });
    const e = entregaChecklist(
      [
        item("a", "2026-08-01", "concluido"),
        item("a", "2026-08-01", "nao_se_aplica"),
        item("a", "2026-09-01", "pendente"),
        item("a", "2026-09-01", "concluido"),
        item("a", "2026-09-01", "pendente", false),
        item("b", "2026-08-01", "correcao"),
      ],
      meses,
    );
    expect(e.porEmpresa.get("a")).toEqual([
      { total: 2, ok: 2 },
      { total: 2, ok: 1 },
    ]);
    expect(e.porMes[0]).toEqual({ total: 3, ok: 2, empresas: 2, completas: 1 });
    expect(percentualInteiro(2, 3)).toBe(67);
    expect(percentualInteiro(0, 0)).toBeNull();
  });
  it("conta pendências atuais", () => {
    const p = pendenciasChecklist(
      [
        { empresa_id: "a", competencia: "2026-08-01", status: "pendente", obrigatorio: true, prazo: "2026-09-10" },
        { empresa_id: "a", competencia: "2026-09-01", status: "correcao", obrigatorio: true, prazo: "2026-10-10" },
        { empresa_id: "a", competencia: "2026-09-01", status: "nao_se_aplica_solicitado", obrigatorio: true, prazo: "2026-09-01" },
      ],
      "2026-10-02",
    );
    expect(p.get("a")).toEqual({ atrasados: 1, faltantes: 2, correcao: 1, naoAplicaRevisar: 1 });
  });
});
