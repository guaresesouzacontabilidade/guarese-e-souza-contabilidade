import { describe, expect, it } from "vitest";
import { calcularIndicadores, diariaDaNoite, diariasDaEstadia, noitesNoPeriodo } from "@/lib/hotel/calculo";
import { gruposEmpresa, type EmpresaMenu } from "@/components/layout/navegacao";

/** Diárias da reserva (tabela, tarifa de período, adicional por pessoa) e indicadores do hotel. */
const casal = { id: "c1", diaria: 250, pessoas_incluidas: 2, adicional_pessoa: 60 };
const tarifas = [
  { categoria_id: "c1", inicio: "2026-12-24", fim: "2026-12-31", diaria: 320, created_at: "2026-10-01T00:00:00Z" },
  { categoria_id: "c1", inicio: "2026-12-31", fim: "2026-12-31", diaria: 480, created_at: "2026-10-02T00:00:00Z" },
  { categoria_id: "outra", inicio: "2026-12-01", fim: "2026-12-31", diaria: 999 },
];

describe("diárias da reserva", () => {
  it("usa a tarifa do período mais curto que cobre a noite; fora dela, a tabela", () => {
    expect(diariaDaNoite(casal, tarifas, "2026-12-20")).toBe(250);
    expect(diariaDaNoite(casal, tarifas, "2026-12-25")).toBe(320);
    expect(diariaDaNoite(casal, tarifas, "2026-12-31")).toBe(480);
  });

  it("soma o adicional por pessoa acima das incluídas e conta as noites até a véspera da saída", () => {
    const n = diariasDaEstadia(casal, tarifas, { entrada: "2026-12-30", saida: "2027-01-02", adultos: 3 });
    expect(n.map((x) => x.data)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(n.map((x) => x.valor)).toEqual([380, 540, 310]);
  });

  it("a diária acordada vale para todas as noites, sem adicional", () => {
    const n = diariasDaEstadia(casal, tarifas, { entrada: "2026-12-30", saida: "2027-01-01", adultos: 3, diariaAcordada: 200 });
    expect(n.map((x) => x.valor)).toEqual([200, 200]);
    expect(diariasDaEstadia(casal, tarifas, { entrada: "2026-12-30", saida: "2026-12-30", adultos: 2 })).toEqual([]);
  });
});

describe("indicadores do hotel", () => {
  it("ocupação pelas noites, diária média pelas diárias cobradas e RevPAR pelos quartos-noite", () => {
    const ind = calcularIndicadores({
      de: "2026-09-01",
      ate: "2026-09-11",
      quartos: 4,
      reservas: [
        { status: "encerrada", entrada: "2026-08-30", saida: "2026-09-03", origem: "booking", categoria: "Casal" },
        { status: "encerrada", entrada: "2026-09-05", saida: "2026-09-08", origem: "whatsapp", categoria: "Luxo" },
        { status: "hospedado", entrada: "2026-09-09", saida: "2026-09-15", origem: "booking", categoria: "Casal" },
      ],
      itens: [
        { tipo: "diaria", total: 250, categoria: "Casal" },
        { tipo: "diaria", total: 250, categoria: "Casal" },
        { tipo: "diaria", total: 300, categoria: "Luxo" },
        { tipo: "diaria", total: 300, categoria: "Luxo" },
        { tipo: "diaria", total: 300, categoria: "Luxo" },
        { tipo: "consumo", total: 40 },
        { tipo: "taxa_servico", total: 4 },
        { tipo: "desconto", total: -20 },
      ],
      canceladas: 1,
      noShow: 0,
    });
    expect(ind.quartosNoite).toBe(40);
    expect(ind.noitesVendidas).toBe(2 + 3 + 2);
    expect(ind.ocupacao).toBeCloseTo(7 / 40);
    expect(ind.noitesFaturadas).toBe(5);
    expect(ind.receitaDiarias).toBe(1400);
    expect(ind.diariaMedia).toBe(280);
    expect(ind.revpar).toBe(35);
    expect(ind.receitaConsumo).toBe(44);
    expect(ind.receitaServicos).toBe(-20);
    expect(ind.porOrigem[0]).toEqual({ origem: "booking", noites: 4, reservas: 2 });
    expect(ind.porDia.find((d) => d.data === "2026-09-06")?.ocupados).toBe(1);
    expect(noitesNoPeriodo({ entrada: "2026-08-30", saida: "2026-09-03" }, "2026-09-01", "2026-09-11")).toBe(2);
  });

  it("separa os serviços extras por tipo (refeições, lavanderia, aluguel), sem os descontos", () => {
    const ind = calcularIndicadores({
      de: "2026-09-01",
      ate: "2026-09-02",
      quartos: 1,
      reservas: [],
      itens: [
        { tipo: "servico", total: 66, setor: "alimentacao" },
        { tipo: "servico", total: 44, setor: "alimentacao" },
        { tipo: "servico", total: 62.5, setor: "lavanderia" },
        { tipo: "servico", total: 360, setor: "locacao" },
        { tipo: "servico", total: 30, setor: null },
        { tipo: "desconto", total: -20 },
      ],
      canceladas: 0,
      noShow: 0,
    });
    expect(ind.receitaServicos).toBe(542.5);
    expect(ind.porServico).toEqual([
      { setor: "locacao", total: 360 },
      { setor: "alimentacao", total: 110 },
      { setor: "lavanderia", total: 62.5 },
      { setor: "outro", total: 30 },
    ]);
  });
});

describe("menu do hotel", () => {
  const empresa = (modalidade: EmpresaMenu["modalidade"], permissoes: EmpresaMenu["permissoes"]): EmpresaMenu => ({
    id: "e1",
    nome: "Hotel",
    documento: "1",
    papel: "cliente_titular",
    permissoes,
    demonstracao: true,
    loja: true,
    modalidade,
  });

  it("modalidade hotel: grupo Hotel e a loja vira Restaurante e bar", () => {
    const grupos = gruposEmpresa(empresa("hotel", ["empresa.ver", "gestao.vender", "gestao.gerenciar"]), false);
    const hotel = grupos.find((g) => g.id === "hotel");
    expect(hotel?.itens.map((i) => i.href)).toContain("/e/e1/hotel/reservas");
    expect(hotel?.itens.map((i) => i.href)).toContain("/e/e1/hotel/relatorios");
    expect(grupos.find((g) => g.id === "loja")?.rotulo).toBe("Restaurante e bar");
  });

  it("a recepção não vê os relatórios; a loja comum não tem o grupo Hotel", () => {
    const recepcao = gruposEmpresa(empresa("hotel", ["empresa.ver", "gestao.vender"]), false);
    expect(recepcao.find((g) => g.id === "hotel")?.itens.map((i) => i.href)).not.toContain("/e/e1/hotel/relatorios");
    expect(gruposEmpresa(empresa("loja", ["empresa.ver", "gestao.vender"]), false).find((g) => g.id === "hotel")).toBeUndefined();
  });
});
