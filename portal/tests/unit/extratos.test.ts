import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { lerOfx } from "@/lib/extratos/ofx";
import { aplicarMapeamento, lerArquivoPlanilha, sugerirMapeamento } from "@/lib/extratos/planilha";
import { extrairDocumento, lerData, numerarOcorrencias } from "@/lib/extratos/comum";
import { dividirParcelas, formatarMoeda, lerValorBR, somar } from "@/lib/dinheiro";

const bytes = (n: string) => new Uint8Array(readFileSync(join(__dirname, "../fixtures", n)));

describe("dinheiro (Decimal)", () => {
  it("lê valores no padrão brasileiro", () => {
    expect(lerValorBR("1.234,56")!.toFixed(2)).toBe("1234.56");
    expect(lerValorBR("R$ 1.234,56")!.toFixed(2)).toBe("1234.56");
    expect(lerValorBR("-10,00")!.toFixed(2)).toBe("-10.00");
    expect(lerValorBR("(10,00)")!.toFixed(2)).toBe("-10.00");
    expect(lerValorBR("12,50 D")!.toFixed(2)).toBe("-12.50");
    expect(lerValorBR("1234.56")!.toFixed(2)).toBe("1234.56");
    expect(lerValorBR("1.234")!.toFixed(2)).toBe("1234.00");
    expect(lerValorBR("abc")).toBeNull();
  });
  it("soma sem erro de ponto flutuante", () => {
    expect(somar(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
    expect(somar([0.1, 0.2]).toFixed(2)).toBe("0.30");
  });
  it("divide parcelas exatas em centavos", () => {
    expect(dividirParcelas("100.00", 3).map((p) => p.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
  });
  it("formata em reais", () => {
    expect(formatarMoeda("1234567.8")).toBe("R$ 1.234.567,80");
    expect(formatarMoeda("-45.9")).toBe("−R$ 45,90");
  });
});

describe("utilitários de extrato", () => {
  it("interpreta datas", () => {
    expect(lerData("05/09/2026")).toBe("2026-09-05");
    expect(lerData("5/9/26")).toBe("2026-09-05");
    expect(lerData("2026-09-05")).toBe("2026-09-05");
    expect(lerData("20260905")).toBe("2026-09-05");
    expect(lerData("31/02/2026")).toBeNull();
    expect(lerData("46270")).toBe("2026-09-05");
  });
  it("extrai CPF/CNPJ válido de descrições", () => {
    expect(extrairDocumento("PIX RECEBIDO 98.765.432/0001-98 CLIENTE")).toBe("98765432000198");
    expect(extrairDocumento("PIX 123.456.789-09")).toBe("12345678909");
    expect(extrairDocumento("PIX 111.111.111-11")).toBeNull();
  });
  it("numera ocorrências idênticas", () => {
    const r = numerarOcorrencias([
      { data: "2026-09-01", valor: "-10.00", descricao: "TARIFA" },
      { data: "2026-09-01", valor: "-10.00", descricao: "Tarifa " },
      { data: "2026-09-02", valor: "-10.00", descricao: "TARIFA" },
    ]);
    expect(r.map((x) => x.ocorrencia)).toEqual([1, 2, 1]);
  });
});

describe("OFX", () => {
  it("lê transações, saldo e conta (Windows-1252, vírgula decimal)", () => {
    const e = lerOfx(bytes("extrato-bb.ofx"));
    expect(e.tipoConta).toBe("banco");
    expect(e.bancoId).toBe("001");
    expect(e.conta).toBe("56789-0");
    expect(e.inicio).toBe("2026-09-01");
    expect(e.fim).toBe("2026-09-30");
    expect(e.transacoes).toHaveLength(4);
    expect(e.transacoes[0]).toMatchObject({ data: "2026-09-30", valor: "1500.00", documento: "98765432000198", fitid: "20260930001" });
    expect(e.transacoes[1].descricao).toBe("TARIFA PACOTE SERVIÇOS");
    expect(e.transacoes[2].valor).toBe("-10.00");
    expect(e.transacoes.map((t) => t.ocorrencia)).toEqual([1, 1, 1, 2]);
    expect(e.saldo).toEqual({ valor: "1434.10", data: "2026-09-30" });
  });
  it("recusa arquivo que não é OFX", () => {
    expect(() => lerOfx("isto não é ofx")).toThrow();
  });
});

describe("planilhas", () => {
  it("CSV: detecta cabeçalho, mapeia colunas e separa saldos e linhas inválidas", async () => {
    const linhas = await lerArquivoPlanilha(bytes("extrato-banco.csv"), "extrato.csv");
    const m = sugerirMapeamento(linhas);
    expect(m.linhaCabecalho).toBe(0);
    expect(m.data).toBe(0);
    expect(m.descricao).toBe(1);
    expect(m.documento).toBe(2);
    expect(m.valor).toBe(3);
    expect(m.tipo).toBe(4);
    expect(m.saldo).toBe(5);
    const r = aplicarMapeamento(linhas, m);
    expect(r.transacoes.map((t) => t.valor)).toEqual(["1000.00", "-200.00", "-12.50", "-12.50"]);
    expect(r.transacoes[0].documento).toBe("98765432000198");
    expect(r.transacoes[1].descricao).toBe("TRANSFERÊNCIA ENVIADA");
    expect(r.transacoes.map((t) => t.ocorrencia)).toEqual([1, 1, 1, 2]);
    expect(r.invalidas).toHaveLength(1);
    expect(r.ignoradas).toHaveLength(2);
    expect(r.saldoFinal).toEqual({ valor: "1775.00", data: "2026-09-30" });
  });
  it("XLSX com colunas de débito e crédito", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Extrato");
    ws.addRow(["Extrato da conta"]);
    ws.addRow(["Data", "Descrição", "Débito", "Crédito"]);
    ws.addRow([new Date(Date.UTC(2026, 8, 3)), "Venda cartão", null, 250.75]);
    ws.addRow(["04/09/2026", "Aluguel", 1200, null]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const linhas = await lerArquivoPlanilha(buf, "x.xlsx");
    const m = sugerirMapeamento(linhas);
    expect(m.linhaCabecalho).toBe(1);
    expect(m.debito).toBe(2);
    expect(m.credito).toBe(3);
    const r = aplicarMapeamento(linhas, m);
    expect(r.transacoes.map((t) => [t.data, t.valor])).toEqual([
      ["2026-09-03", "250.75"],
      ["2026-09-04", "-1200.00"],
    ]);
  });
  it("recusa .xls antigo com mensagem útil", async () => {
    await expect(lerArquivoPlanilha(new Uint8Array([1, 2, 3]), "a.xls")).rejects.toThrow(/xlsx ou .csv/);
  });
});
