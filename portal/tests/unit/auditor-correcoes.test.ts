import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { GUIAS_CORRECAO, comoSaiu, formatarNcm, sugestaoProduto, type ProdutoCorrecao } from "@/lib/auditor-fiscal/correcoes";
import { blocosRelatorioCorrecoes, planilhaCorrecoes, type DadosRelatorioCorrecoes } from "@/lib/auditor-fiscal/relatorio";
import { ROTULO_REGRA } from "@/lib/auditor-fiscal/rotulos";
import { gerarPdf } from "@/lib/relatorios/pdf";

const produto = (extra: Partial<ProdutoCorrecao> = {}): ProdutoCorrecao => ({
  codigo: "789",
  descricao: "DIPIRONA 500MG 10 COMP",
  ncm: "30049099",
  cfop: "5102",
  csosn: "102",
  cst_icms: null,
  cst_pis: "49",
  cst_cofins: "49",
  operacao: "saida",
  motivo: "comprado com ST, vendido como tributado",
  itens: 3,
  notas: 2,
  valor: "360.00",
  lista: [
    { numero: "101", modelo: "65", data: "2026-09-10", documento_id: null, valor: "180.00" },
    { numero: "102", modelo: "65", data: "2026-09-12", documento_id: null, valor: "180.00" },
  ],
  ...extra,
});

describe("relatório de correções — como corrigir cada achado", () => {
  it("todo tipo de achado do auditor tem os passos para corrigir", () => {
    for (const regra of Object.keys(ROTULO_REGRA)) {
      expect(GUIAS_CORRECAO[regra]?.passos.length, regra).toBeGreaterThan(0);
    }
  });

  it("sugere o código fiscal certo para o produto (dentro e fora do Estado)", () => {
    expect(sugestaoProduto("st_simples", produto())).toBe("CSOSN 500 · CFOP 5.405");
    expect(sugestaoProduto("st_simples", produto({ cfop: "6102" }))).toBe("CSOSN 500 · CFOP 6.404");
    expect(sugestaoProduto("icms_st_regime_normal", produto({ csosn: null, cst_icms: "00" }))).toBe("CST 60 (sem ICMS próprio) · CFOP 5.405");
    // Venda como ST sem compra com ST: volta a ser tributada (Simples usa CSOSN; regime normal, CST)
    expect(sugestaoProduto("st_sem_compra_st", produto({ csosn: "500", cfop: "5405" }))).toBe("CSOSN 102 · CFOP 5.102");
    expect(sugestaoProduto("venda_st_fora_da_st", produto({ csosn: null, cst_icms: "60", cfop: "6404" }))).toBe("CST 00 · CFOP 6.102");
    expect(sugestaoProduto("monofasico_regime_normal", produto())).toContain("CST 04");
    expect(sugestaoProduto("regra_desconhecida", produto())).toBe("Conferir com o escritório");
  });

  it("mostra como o produto saiu na nota e formata o NCM", () => {
    expect(comoSaiu(produto())).toBe("CFOP 5.102 · CSOSN 102 · PIS/Cofins 49");
    expect(comoSaiu(produto({ csosn: null, cst_icms: "00", cst_pis: "01", cst_cofins: "02" }))).toBe("CFOP 5.102 · CST 00 · PIS/Cofins 01/02");
    expect(formatarNcm("30049099")).toBe("3004.90.99");
    expect(formatarNcm("3004")).toBe("3004");
    expect(formatarNcm(null)).toBe("sem NCM");
  });
});

describe("relatório de correções — PDF e planilha", () => {
  const dados: DadosRelatorioCorrecoes = {
    achados: [
      {
        id: "a1",
        regra: "st_simples",
        competencia: "2026-09-01",
        tipo: "oportunidade",
        confianca: "alta",
        titulo: "ICMS-ST pago de novo no DAS",
        resumo: "Resumo técnico do achado.",
        texto_cliente: "Explicação para o cliente.",
        valor_estimado: "8.11",
        situacao: "confirmado",
        referencias: [],
        fontes: [{ titulo: "LC 123/2006, art. 18, § 4º-A" }],
        produtos: [produto()],
      },
      {
        id: "a2",
        regra: "iss_retido_simples",
        competencia: "2026-08-01",
        tipo: "oportunidade",
        confianca: "alta",
        titulo: "ISS retido pago de novo no DAS",
        resumo: "ISS retido.",
        texto_cliente: null,
        valor_estimado: "100.00",
        situacao: "publicado",
        referencias: [{ documento_id: null, numero: "55", modelo: "nfse", data: "2026-08-05", valor: "10000.00", descricao: "Consultoria", motivo: "ISS retido pelo tomador" }] as never,
        fontes: [],
        produtos: [],
      },
    ],
    economia: 108.11,
    produtos: 1,
    notas: 3,
    periodo: "agosto de 2026 a setembro de 2026",
  };

  it("explica cada achado com os passos, os produtos (corrigir para) e as notas", () => {
    const texto = JSON.stringify(blocosRelatorioCorrecoes(dados, "Ajustem o cadastro, por favor."));
    expect(texto).toContain("Recado do escritório");
    expect(texto).toContain("Ajustem o cadastro, por favor.");
    expect(texto).toContain("Explicação para o cliente.");
    expect(texto).toContain("Como corrigir");
    expect(texto).toContain("Corrigir para");
    expect(texto).toContain("CSOSN 500 · CFOP 5.405");
    expect(texto).toContain("101 (10/09/2026), 102 (12/09/2026)");
    // Achado sem produtos (serviço): as notas de exemplo
    expect(texto).toContain("NFS-e 55");
    expect(texto).toContain("LC 123/2006, art. 18, § 4º-A");
  });

  it("gera o PDF", async () => {
    const pdf = await gerarPdf(
      {
        titulo: "Relatório de correções fiscais",
        subtitulo: "Auditor fiscal — teste",
        empresa: { nome: "Farmácia Fictícia", documento: "11.222.333/0001-81" },
        escritorio: { nome: "Guarese's ON", razao: "Escritório de teste", cnpj: "00.000.000/0001-00", email: null, endereco: "" },
        situacao: "documento",
        geradoEm: new Date().toISOString(),
      },
      blocosRelatorioCorrecoes(dados, null),
    );
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("monta a planilha de produtos e a de notas", async () => {
    const wb = new ExcelJS.Workbook();
    planilhaCorrecoes(wb, { titulo: "Relatório de correções fiscais", empresa: "Farmácia Fictícia", periodo: dados.periodo, situacao: "teste", geradoEm: "29/10/2026 10:00" }, dados);
    const produtos = wb.getWorksheet("Produtos a corrigir")!;
    const notas = wb.getWorksheet("Notas")!;
    const valores = (ws: ExcelJS.Worksheet) => {
      const linhas: unknown[][] = [];
      ws.eachRow((r) => linhas.push((r.values as unknown[]).slice(1)));
      return linhas;
    };
    const linhaProduto = valores(produtos).find((l) => l.includes("DIPIRONA 500MG 10 COMP"))!;
    expect(linhaProduto).toEqual(expect.arrayContaining(["1. ICMS-ST no DAS", "3004.90.99", "5102", "102", 360, "CSOSN 500 · CFOP 5.405"]));
    const linhasNotas = valores(notas);
    expect(linhasNotas.filter((l) => l.includes("DIPIRONA 500MG 10 COMP"))).toHaveLength(2);
    expect(linhasNotas.some((l) => l.includes("Consultoria") && l.includes("NFS-e"))).toBe(true);
  });
});
