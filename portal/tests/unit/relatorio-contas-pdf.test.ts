import { describe, expect, it } from "vitest";
import { lerRelatorioContasPdf, lerRelatorioContasTrechos, RelatorioIlegivel } from "@/lib/financeiro/relatorio-contas-pdf";
import { aplicarMapeamentoLancamentos, sugerirMapeamentoLancamentos } from "@/lib/financeiro/importacao";
import type { Trecho } from "@/lib/gestao/danfe-pdf";
import { contasFicticias, relatorioContasFicticio } from "../apoio/relatorio-contas-ficticio";

/**
 * Relatório de contas a pagar em PDF (fictício, no leiaute dos sistemas de
 * gestão de lojas): a tabela vira linhas de planilha, a soma e a quantidade
 * conferem com o resumo, o tipo vem do título, CPF e CNPJ viram uma coluna, e
 * as contas já pagas ficam de fora na importação.
 */
describe("relatório de contas a pagar em PDF", () => {
  it("lê todas as contas em várias páginas e confere com o resumo", async () => {
    const contas = contasFicticias();
    // Muitas linhas para passar de uma página
    const muitas = [...contas, ...contas.map((c) => ({ ...c, descricao: `${c.descricao} B` })), ...contas.map((c) => ({ ...c, descricao: `${c.descricao} C` }))];
    const pdf = await relatorioContasFicticio({ contas: muitas });
    const r = await lerRelatorioContasPdf(new Uint8Array(pdf));
    expect(r.tipo).toBe("pagar");
    expect(r.linhas[0]).toEqual(["Destinado à", "CPF/CNPJ", "Descrição", "Data de vencimento", "Situação", "Valor", "Valor total"]);
    expect(r.linhas.length - 1).toBe(muitas.length);
    expect(r.resumo.quantidade).toBe(muitas.length);
    expect(r.conferencia.confere).toBe(true);
    expect(r.conferencia.problemas).toEqual([]);
    expect(r.conferencia.soma).toBe(r.resumo.total);
    // Linha com fornecedor e CNPJ
    const frete = r.linhas.find((l) => l[2] === "FRETE TORAS TESTE");
    expect(frete).toEqual(["TRANSPORTADORA FICTICIA LTDA", "11.222.333/0001-81", "FRETE TORAS TESTE", "12/02/2027", "Em aberto", "5.600,00", "5.600,00"]);
    expect(r.linhas.find((l) => l[2] === "TORAS DE PINUS FORNECEDOR TESTE (3/6)")?.[3]).toBe("25/03/2027");
  });

  it("vira contas a pagar com as datas e os valores (pelo mesmo mapeamento das planilhas)", async () => {
    const r = await lerRelatorioContasPdf(new Uint8Array(await relatorioContasFicticio()));
    const m = { ...sugerirMapeamentoLancamentos(r.linhas), tipoFixo: r.tipo };
    expect(m.linhaCabecalho).toBe(0);
    const { validas, invalidas, ignoradas } = aplicarMapeamentoLancamentos(r.linhas, m);
    expect(invalidas).toEqual([]);
    expect(ignoradas).toEqual([]);
    expect(validas).toHaveLength(contasFicticias().length);
    const pinus = validas.find((v) => v.descricao === "TORAS DE PINUS FORNECEDOR TESTE (2/6)")!;
    expect(pinus).toMatchObject({ tipo: "pagar", data_vencimento: "2027-02-25", data_competencia: "2027-02-25", valor: "8450.00" });
    const frete = validas.find((v) => v.descricao === "FRETE TORAS TESTE")!;
    expect(frete).toMatchObject({ contraparte_nome: "TRANSPORTADORA FICTICIA LTDA", contraparte_documento: "11222333000181" });
    expect(validas.find((v) => v.descricao === "SALARIO FUNCIONARIO FICTICIO")?.contraparte_nome).toBe("FUNCIONARIO FICTICIO DA SILVA");
  });

  it("as contas já pagas ou canceladas ficam de fora", async () => {
    const contas = contasFicticias();
    contas[0] = { ...contas[0], situacao: "Pago" };
    contas[1] = { ...contas[1], situacao: "Cancelado" };
    const r = await lerRelatorioContasPdf(new Uint8Array(await relatorioContasFicticio({ contas })));
    expect(r.conferencia.confere).toBe(true);
    const { validas, ignoradas } = aplicarMapeamentoLancamentos(r.linhas, { ...sugerirMapeamentoLancamentos(r.linhas), tipoFixo: "pagar" });
    expect(validas).toHaveLength(contas.length - 2);
    expect(ignoradas.map((i) => i.motivo)).toEqual(["Já paga (Pago): não importada.", "Cancelada: não importada."]);
  });

  it("só as contas com vencimento a partir da data escolhida", async () => {
    const r = await lerRelatorioContasPdf(new Uint8Array(await relatorioContasFicticio()));
    const m = { ...sugerirMapeamentoLancamentos(r.linhas), tipoFixo: r.tipo, apartir: "2027-03-01" };
    const { validas, ignoradas } = aplicarMapeamentoLancamentos(r.linhas, m);
    expect(validas.every((v) => v.data_vencimento >= "2027-03-01")).toBe(true);
    expect(ignoradas.length).toBeGreaterThan(0);
    expect(ignoradas.every((i) => i.motivo === "Vencimento antes de 01/03/2027: não importada.")).toBe(true);
    expect(validas.length + ignoradas.length).toBe(contasFicticias().length);
  });

  it("relatório de contas a receber vem como a receber", async () => {
    const r = await lerRelatorioContasPdf(new Uint8Array(await relatorioContasFicticio({ tipo: "receber" })));
    expect(r.tipo).toBe("receber");
    expect(r.conferencia.confere).toBe(true);
  });

  it("aponta quando a soma ou a quantidade não batem com o resumo", async () => {
    const r1 = await lerRelatorioContasPdf(new Uint8Array(await relatorioContasFicticio({ totalErrado: true })));
    expect(r1.conferencia.confere).toBe(false);
    expect(r1.conferencia.problemas[0]).toMatch(/não bate com o total do relatório/);
    const r2 = await lerRelatorioContasPdf(new Uint8Array(await relatorioContasFicticio({ quantidadeErrada: true })));
    expect(r2.conferencia.confere).toBe(false);
    expect(r2.conferencia.problemas[0]).toMatch(/Foram lidas \d+ contas, mas o relatório informa \d+/);
  });

  it("descrição quebrada em duas linhas continua uma conta só", () => {
    const t = (pagina: number, x: number, y: number, texto: string, largura = texto.length * 4): Trecho => ({ pagina, x, y, largura, texto });
    const trechos = [
      t(1, 40, 560, "Relatório de contas a pagar"),
      t(1, 600, 520, "Total"),
      t(1, 590, 505, "300,00"),
      t(1, 590, 495, "2 cobranças no período"),
      t(1, 200, 450, "Descrição"),
      t(1, 400, 450, "Data de vencimento"),
      t(1, 520, 450, "Situação"),
      t(1, 600, 450, "Valor"),
      t(1, 180, 430, "COMPRA DE PREGOS E"),
      t(1, 400, 430, "10/01/2027"),
      t(1, 520, 430, "Em aberto"),
      t(1, 600, 430, "100,00"),
      t(1, 185, 420, "PARAFUSOS"),
      t(1, 180, 405, "ALUGUEL"),
      t(1, 400, 405, "15/01/2027"),
      t(1, 520, 405, "Em aberto"),
      t(1, 600, 405, "200,00"),
      t(1, 700, 30, "Página 1 de 1"),
    ];
    const r = lerRelatorioContasTrechos(trechos);
    expect(r.linhas.slice(1).map((l) => l[0])).toEqual(["COMPRA DE PREGOS E PARAFUSOS", "ALUGUEL"]);
    expect(r.conferencia.confere).toBe(true);
  });

  it("PDF sem a tabela de contas ou sem texto é recusado com explicação", () => {
    expect(() => lerRelatorioContasTrechos([])).toThrow(RelatorioIlegivel);
    expect(() => lerRelatorioContasTrechos([{ pagina: 1, x: 10, y: 10, largura: 50, texto: "Nota fiscal de serviço" }])).toThrow(/Não achamos a tabela de contas/);
  });
});
