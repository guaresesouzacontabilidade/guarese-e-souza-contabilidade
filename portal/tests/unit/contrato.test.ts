import { describe, expect, it } from "vitest";
import { clausulasAditivo, clausulasContrato, clausulasDistrato, identificacaoPartes, mudancasDaFicha, rotuloClausula, type ConteudoContrato } from "@/lib/honorarios/contrato";

const base: ConteudoContrato = {
  partes: {
    escritorio: {
      razao_social: "ESCRITORIO EXEMPLO LTDA",
      nome_fantasia: "Escritório Exemplo",
      cnpj: "62935399000150",
      endereco: "Praça Central, nº 1, Centro, Porto Nacional/TO",
      cidade: "Porto Nacional",
      uf: "TO",
      contador_nome: "Contador Exemplo",
      contador_crc: "CRC TO-012345/O",
    },
    cliente: { razao_social: "PADARIA EXEMPLO LTDA", documento: "11222333000181", endereco: "Rua A, nº 2, Palmas/TO" },
  },
  condicoes: {
    valor_mensal: 850,
    dia_vencimento: 10,
    inicio: "2026-10-01",
    servicos: ["contabil", "fiscal", "folha"],
    funcionarios_inclusos: 2,
    valor_funcionario_extra: 35,
    notas_inclusas: null,
    valor_nota_extra: null,
    decimo_terceiro: true,
    decimo_terceiro_mes: 12,
    reajuste_indice: "ipca",
    reajuste_mes: 1,
    competencia_referencia: "mes_anterior",
    cobrar_encargos: true,
    multa_percentual: 2,
    juros_mes_percentual: 1,
  },
  opcoes: { aviso_previo_dias: 30, dia_documentos: 5, foro: "Porto Nacional/TO", adicional: null },
};

const tudo = (cl: { titulo: string; paragrafos: string[] }[]) => cl.map((c) => `${c.titulo}\n${c.paragrafos.join("\n")}`).join("\n");

describe("Contrato pela ficha (Resolução CFC nº 1.590/2020, art. 2º)", () => {
  const cl = clausulasContrato(base);
  const t = tudo(cl);

  it("identifica as partes (a)", () => {
    const [contratada, contratante] = identificacaoPartes(base.partes);
    expect(contratada).toContain("CNPJ sob o nº 62.935.399/0001-50");
    expect(contratada).toContain("CRC TO-012345/O");
    expect(contratante).toContain("PADARIA EXEMPLO LTDA");
    expect(contratante).toContain("11.222.333/0001-81");
  });

  it("detalha só os serviços marcados (b) e o que cabe ao cliente (c)", () => {
    expect(t).toContain("a) Contabilidade");
    expect(t).toContain("b) Fiscal");
    expect(t).toContain("c) Folha de pagamento");
    expect(t).not.toContain("Rotinas financeiras (BPO)");
    expect(t).toContain("até o dia 5 do mês seguinte");
    // IR dos sócios não marcado = serviço eventual
    expect(t).toContain("declarações de imposto de renda de pessoas físicas");
  });

  it("duração (d), honorários por extenso (e), prazo de pagamento (f) e reajuste (g)", () => {
    expect(t).toContain("prazo indeterminado, a partir da competência de outubro de 2026");
    expect(t).toContain("R$ 850,00 (oitocentos e cinquenta reais)");
    expect(t).toContain("até o dia 10 do mês seguinte ao da prestação dos serviços");
    expect(t).toContain("acrescenta R$ 35,00");
    expect(t).toContain("13º honorário");
    expect(t).toContain("variação acumulada do IPCA");
    expect(t).toContain("no mês de janeiro");
    expect(t).toContain("multa de 2% e a juros de 1% ao mês");
  });

  it("responsabilidades (h), aditamento (i), Carta de Responsabilidade (j), Lei 9.613 (k), rescisão com aviso (l) e foro (m)", () => {
    expect(t).toContain("Das obrigações da contratante");
    expect(t).toContain("Das obrigações da contratada");
    expect(t).toContain("termo aditivo");
    expect(t).toContain("Carta de Responsabilidade da Administração");
    expect(t).toContain("Lei nº 9.613/1998");
    expect(t).toContain("aviso prévio por escrito de 30 (trinta) dias");
    expect(t).toContain("foro da comarca de Porto Nacional/TO");
  });

  it("LGPD sem uso para inteligência artificial e assinatura eletrônica", () => {
    expect(t).toContain("Lei nº 13.709/2018");
    expect(t).toContain("treinamento de inteligência artificial");
    expect(t).toContain("Medida Provisória nº 2.200-2/2001");
  });

  it("cláusula adicional do escritório entra antes do foro", () => {
    const c = clausulasContrato({ ...base, opcoes: { ...base.opcoes, adicional: "Atendimento presencial às terças." } });
    expect(c.at(-2)?.titulo).toBe("Disposições adicionais");
    expect(c.at(-1)?.titulo).toBe("Do foro");
  });

  it("numera as cláusulas por extenso", () => {
    expect(rotuloClausula(0, "Do objeto")).toBe("CLÁUSULA PRIMEIRA — DO OBJETO");
    expect(rotuloClausula(10, "Do foro")).toBe("CLÁUSULA DÉCIMA PRIMEIRA — DO FORO");
  });
});

describe("Aditivo e distrato", () => {
  it("lista o que mudou na ficha", () => {
    const depois = { ...base.condicoes, valor_mensal: 950, servicos: ["contabil", "fiscal", "folha", "irpf"], decimo_terceiro: false };
    const m = mudancasDaFicha(base.condicoes, depois);
    expect(m[0]).toBe("Os honorários mensais passam de R$ 850,00 (oitocentos e cinquenta reais) para R$ 950,00 (novecentos e cinquenta reais).");
    expect(m.some((x) => x.startsWith("Passa a fazer parte dos serviços habituais: Imposto de renda dos sócios"))).toBe(true);
    expect(m).toContain("Deixa de ser devido o 13º honorário.");
    expect(mudancasDaFicha(base.condicoes, base.condicoes)).toEqual([]);
    const ad = tudo(clausulasAditivo("0001/2026", m, "2026-12-01", "Porto Nacional/TO"));
    expect(ad).toContain("contrato de prestação de serviços contábeis nº 0001/2026");
    expect(ad).toContain("a partir da competência de dezembro de 2026");
  });

  it("distrato com cessação, obrigações do período e devolução (arts. 6º a 10)", () => {
    const t = tudo(clausulasDistrato("0001/2026", { data_fim: "2027-03-31", ultima_competencia: "2027-03-01", prazo_devolucao_dias: 30, foro: "Porto Nacional/TO" }));
    expect(t).toContain("em 31/03/2027");
    expect(t).toContain("cessam as responsabilidades");
    expect(t).toContain("até a competência de março de 2027");
    expect(t).toContain("em até 30 dias");
    expect(t).toContain("novo responsável técnico");
  });
});
