import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { montarDre } from "@/lib/relatorios/calculos";
import { secoesDre } from "@/lib/relatorios/tabelas";
import { gerarPdf, gerarXlsx } from "@/lib/relatorios/exportacao";

const meses = ["2026-08-01", "2026-09-01"];
const dre = montarDre(meses, [
  { mes: "2026-08-01", categoria_id: "v", categoria_codigo: "1.01", categoria_nome: "Vendas", tipo: "receita_operacional", valor: "1000.10" },
  { mes: "2026-09-01", categoria_id: "a", categoria_codigo: "4.01", categoria_nome: "=Aluguel", tipo: "despesa_operacional", valor: 1500 },
]);
const secoes = secoesDre({ ...dre, meses });

describe("exportação de relatórios", () => {
  it("gera planilha com valores numéricos e texto protegido", async () => {
    const buf = await gerarXlsx("DRE — Teste", "agosto a setembro", secoes);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    expect(ws.getRow(4).getCell(1).value).toBe("Linha");
    const linhas: unknown[][] = [];
    ws.eachRow((r) => linhas.push((r.values as unknown[]).slice(1)));
    const receita = linhas.find((l) => l[0] === "Receita bruta")!;
    expect(receita[1]).toBe(1000.1);
    const resultado = linhas.find((l) => l[0] === "Resultado líquido")!;
    expect(resultado[3]).toBe(-499.9);
    // Categorias aparecem recuadas abaixo do grupo
    expect(linhas.some((l) => String(l[0]) === "    4.01 =Aluguel")).toBe(true);
  });

  it("gera PDF", async () => {
    const pdf = await gerarPdf("DRE — Teste", "agosto a setembro", secoes);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  }, 20000);
});
