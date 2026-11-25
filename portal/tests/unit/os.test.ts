import { describe, expect, it } from "vitest";
import { andamento, atrasada, execucaoAgora, formatarMinutos, linkWhatsApp, minutosDoItem, montarMensagem, tempoNaEtapa, type TempoOs } from "@/lib/os/rotulos";
import { diaLocal, fatoresPorServico, montarRelatorio, type ItemRelatorio, type OrdemRelatorio } from "@/lib/os/relatorio";

const AGORA = new Date("2026-11-25T15:00:00Z").getTime();
const base: TempoOs = {
  etapa: "execucao",
  minutos_estimados: 60,
  minutos_execucao: 20,
  minutos_pausa: 0,
  execucao_desde: "2026-11-25T14:30:00Z",
  pausada: false,
  pausada_em: null,
  aberta_em: "2026-11-25T13:00:00Z",
  iniciada_em: "2026-11-25T14:00:00Z",
  pronta_em: null,
  entregue_em: null,
  prazo: null,
  previsao: "2026-11-25T16:00:00Z",
};

describe("tempos da OS", () => {
  it("formata os minutos em linguagem simples", () => {
    expect(formatarMinutos(45)).toBe("45 min");
    expect(formatarMinutos(76)).toBe("1h 16min");
    expect(formatarMinutos(120)).toBe("2h");
    expect(formatarMinutos(0.4)).toBe("menos de 1 min");
    expect(formatarMinutos(60 * 26)).toBe("26h");
    expect(formatarMinutos(60 * 100)).toBe("4d 4h");
  });

  it("conta a execução sem as pausas e mostra o andamento", () => {
    expect(execucaoAgora(base, AGORA)).toBe(50);
    expect(andamento(base, AGORA)).toEqual({ percentual: 83, situacao: "perto" });
    const pausada = { ...base, pausada: true, execucao_desde: null, pausada_em: "2026-11-25T14:50:00Z", minutos_execucao: 40 };
    expect(execucaoAgora(pausada, AGORA)).toBe(40);
    expect(andamento({ ...base, minutos_execucao: 50 }, AGORA).situacao).toBe("estourou");
  });

  it("relógio da etapa e atraso pelo prazo ou pela previsão", () => {
    expect(tempoNaEtapa({ ...base, etapa: "fila", execucao_desde: null }, AGORA)).toBe(120);
    expect(atrasada(base, AGORA)).toBe(false);
    expect(atrasada({ ...base, prazo: "2026-11-25T14:00:00Z" }, AGORA)).toBe(true);
    expect(atrasada({ ...base, etapa: "pronta", pronta_em: "2026-11-25T16:30:00Z" }, AGORA)).toBe(true);
    expect(atrasada({ ...base, etapa: "pronta", pronta_em: "2026-11-25T15:30:00Z" }, AGORA)).toBe(false);
  });

  it("tempo do item: fixo + por unidade × quantidade", () => {
    expect(minutosDoItem({ minutos_fixos: 10, minutos_por_unidade: 4 }, 5)).toBe(30);
    expect(minutosDoItem({ minutos_fixos: "0", minutos_por_unidade: "1.5" }, 20)).toBe(30);
    expect(minutosDoItem(null, 3, 16)).toBe(16);
  });

  it("mensagem e link do WhatsApp", () => {
    const msg = montarMensagem("Olá, {cliente}! OS {numero} pronta na {loja}: {link}", { cliente: "Carlos da Silva", numero: 12, link: "https://x/acompanhar/abc", loja: "Madeireira" });
    expect(msg).toBe("Olá, Carlos! OS 12 pronta na Madeireira: https://x/acompanhar/abc");
    expect(linkWhatsApp("(63) 99999-1234", "oi")).toBe("https://wa.me/5563999991234?text=oi");
    expect(linkWhatsApp("123", "oi")).toBeNull();
  });
});

describe("relatório de desempenho", () => {
  const ordem = (o: Partial<OrdemRelatorio>): OrdemRelatorio => ({
    id: "x",
    numero: 1,
    cliente_nome: "Cliente",
    etapa: "pronta",
    prioridade: "normal",
    responsavel_id: "joao",
    prazo: null,
    previsao: null,
    minutos_estimados: 30,
    minutos_execucao: 30,
    minutos_pausa: 0,
    valor_total: 100,
    aberta_em: "2026-11-02T12:00:00Z",
    iniciada_em: "2026-11-02T13:00:00Z",
    pronta_em: "2026-11-02T14:00:00Z",
    entregue_em: null,
    cancelada_em: null,
    ...o,
  });
  // Corte de MDF: estimado 4 min/chapa; na prática leva 6 min/chapa
  const ordens = [1, 2, 3].map((k) =>
    ordem({ id: `o${k}`, numero: k, minutos_estimados: 40, minutos_execucao: 60, prazo: k === 3 ? "2026-11-02T13:30:00Z" : "2026-11-03T12:00:00Z" }),
  );
  ordens.push(ordem({ id: "o4", numero: 4, etapa: "fila", iniciada_em: null, pronta_em: null, aberta_em: "2026-11-05T12:00:00Z" }));
  ordens.push(ordem({ id: "o5", numero: 5, etapa: "entregue", entregue_em: "2026-11-02T18:00:00Z", responsavel_id: null }));
  const itens: ItemRelatorio[] = [
    ...[1, 2, 3].map((k) => ({ ordem_id: `o${k}`, servico_id: "corte", descricao: "Corte de MDF", quantidade: 10, unidade: "chapa", minutos_estimados: 40 })),
    { ordem_id: "o5", servico_id: null, descricao: "Furação", quantidade: 4, unidade: "furo", minutos_estimados: 30 },
  ];
  const r = montarRelatorio(
    {
      ordens,
      itens,
      servicos: [{ id: "corte", nome: "Corte de MDF", unidade: "chapa", minutos_por_unidade: 4, minutos_fixos: 0 }],
      equipe: [{ id: "joao", nome: "João" }],
    },
    "2026-11-01",
    "2026-11-30",
  );

  it("conta abertas, concluídas e entregues e os tempos médios", () => {
    expect(r.abertas).toBe(5);
    expect(r.concluidas).toBe(4);
    expect(r.entregues).toBe(1);
    expect(r.mediaFila).toBe(60);
    expect(r.mediaTotal).toBe(120);
    expect(r.mediaAguardandoRetirada).toBe(240);
    expect(r.valorConcluido).toBe(400);
  });

  it("compara estimado × real, prazo e sugere ajustar a estimativa", () => {
    expect(r.estimadoTotal).toBe(150);
    expect(r.realTotal).toBe(210);
    expect(r.desvioPercentual).toBe(40);
    expect(r.comPrazo).toBe(3);
    expect(r.noPrazo).toBe(2);
    const corte = r.porServico.find((s) => s.chave === "corte")!;
    // O fator do corte sai ~1,5 (um pouco puxado para 1 por haver poucas OS)
    expect(corte).toMatchObject({ ordens: 3, quantidade: 30, minutosEstimados: 120, sugestaoPorUnidade: 6 });
    expect(corte.minutosReais).toBeGreaterThan(178);
    expect(corte.desvioPercentual).toBeGreaterThanOrEqual(48);
    expect(corte.realPorUnidade).toBeCloseTo(6, 0);
    expect(r.porServico.find((s) => s.chave.startsWith("avulso:"))?.sugestaoPorUnidade).toBeNull();
  });

  it("descobre quanto cada serviço leva de verdade comparando as OS", () => {
    // Corte leva 1,5× o estimado; fita leva o estimado
    const ordens = [
      { corte: 20, fita: 10 },
      { corte: 40, fita: 5 },
      { corte: 10, fita: 30 },
      { corte: 30, fita: 20 },
      { corte: 0, fita: 25 },
    ].map((o) => ({ real: o.corte * 1.5 + o.fita, estimados: new Map(Object.entries(o).filter(([, v]) => v > 0)) }));
    const f = fatoresPorServico(ordens)!;
    expect(f.get("corte")).toBeCloseTo(1.5, 1);
    expect(f.get("fita")).toBeCloseTo(1, 1);
    expect(fatoresPorServico(ordens.slice(0, 1))).toBeNull();
  });

  it("separa por responsável e por dia", () => {
    expect(r.porResponsavel[0]).toMatchObject({ nome: "João", concluidas: 3, minutosExecucao: 180, mediaExecucao: 60, noPrazo: 2, comPrazo: 3 });
    expect(r.porResponsavel.find((l) => l.id === null)?.nome).toBe("Sem responsável");
    expect(r.porDia).toHaveLength(30);
    expect(r.porDia.find((d) => d.dia === "2026-11-02")).toEqual({ dia: "2026-11-02", abertas: 4, concluidas: 4 });
    expect(diaLocal("2026-11-02T02:00:00Z")).toBe("2026-11-01");
  });
});

describe("recebimentos, aviso automático e assinatura", () => {
  it("quanto falta receber e a situação do pagamento", async () => {
    const { faltaReceber, situacaoPagamento } = await import("@/lib/os/rotulos");
    expect(faltaReceber({ valor_total: "108.00", valor_recebido: "50.00", valor_a_receber: "0" })).toBe(58);
    expect(faltaReceber({ valor_total: 30, valor_recebido: 0, valor_a_receber: 30 })).toBe(0);
    expect(faltaReceber({ valor_total: 10, valor_recebido: 12, valor_a_receber: 0 })).toBe(0);
    expect(situacaoPagamento({ valor_total: 0, valor_recebido: 0, valor_a_receber: 0 })).toBe("sem_valor");
    expect(situacaoPagamento({ valor_total: 100, valor_recebido: 0, valor_a_receber: 0 })).toBe("aberto");
    expect(situacaoPagamento({ valor_total: 100, valor_recebido: 40, valor_a_receber: 0 })).toBe("parcial");
    expect(situacaoPagamento({ valor_total: 100, valor_recebido: 70, valor_a_receber: 30 })).toBe("a_receber");
    expect(situacaoPagamento({ valor_total: 100, valor_recebido: 100, valor_a_receber: 0 })).toBe("pago");
  });

  it("o aviso de pronta leva só o primeiro nome, o número, a loja e o link", async () => {
    const { parametrosAvisoOs } = await import("@/lib/os/rotulos");
    expect(parametrosAvisoOs({ cliente: "  Carlos Marceneiro da Silva ", numero: 37, loja: "Madeireira\nReflorestar", link: "https://portal/acompanhar/abc" })).toEqual([
      "Carlos",
      "37",
      "Madeireira Reflorestar",
      "https://portal/acompanhar/abc",
    ]);
  });

  it("só aceita a assinatura como imagem PNG de tamanho razoável", async () => {
    const { assinaturaValida } = await import("@/lib/os/rotulos");
    const png = `data:image/png;base64,${"iVBORw0KGgo".padEnd(400, "A")}`;
    expect(assinaturaValida(png)).toBe(true);
    expect(assinaturaValida(null)).toBe(false);
    expect(assinaturaValida("data:image/jpeg;base64,AAAA")).toBe(false);
    expect(assinaturaValida("data:image/png;base64,curta")).toBe(false);
    expect(assinaturaValida(`data:image/png;base64,${"A".repeat(500_000)}`)).toBe(false);
    expect(assinaturaValida("data:image/png;base64,<script>alert(1)</script>".padEnd(400, "A"))).toBe(false);
  });
});

describe("confirmação da fisioterapia pelo WhatsApp", () => {
  it("o modelo leva só o primeiro nome, o horário, a clínica e o link", async () => {
    const { parametrosConfirmacaoFisio } = await import("@/lib/fisioterapia/rotulos");
    expect(parametrosConfirmacaoFisio({ paciente: "Ana Paula Souza", hora: "14:00", clinica: "Clínica\nMovimento", link: "https://portal/confirmar/abc" })).toEqual([
      "Ana",
      "14:00",
      "Clínica Movimento",
      "https://portal/confirmar/abc",
    ]);
    expect(parametrosConfirmacaoFisio({ paciente: "  ", hora: "08:30", clinica: "X", link: "l" })[0]).toBe("paciente");
  });
});
