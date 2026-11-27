import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { hojeLocal } from "@/lib/gestao/contexto";
import { carregarComissoes, lerFiltroComissoes } from "@/lib/gestao/comissoes";

const UUID = /^[0-9a-f-]{36}$/i;

/** Planilha das comissões do período (o banco só entrega as do próprio vendedor para quem não gerencia). */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada.", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const empresaId = sp.get("empresa") ?? "";
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !(acesso.permissoes.has("gestao.vender") || acesso.permissoes.has("gestao.gerenciar"))) return new NextResponse("Acesso negado.", { status: 403 });

  const hoje = hojeLocal();
  const f = lerFiltroComissoes(Object.fromEntries(sp.entries()), hoje);
  const { linhas, resumo } = await carregarComissoes(s.supabase, empresaId, f);

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = acesso.nome_fantasia ?? acesso.razao_social;
  const moeda = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  const titulo = (ws: import("exceljs").Worksheet, cab: string[]) => {
    ws.addRow(cab);
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5F3F" } };
  };

  const r = wb.addWorksheet("Por vendedor", { views: [{ state: "frozen", ySplit: 1 }] });
  titulo(r, ["Vendedor", "Vendas", "Vendido (base)", "Comissão", "Já lançado", "A lançar"]);
  for (const x of resumo) r.addRow([x.vendedor, x.vendas, x.vendido, x.comissao, x.lancado, x.aLancar]);
  [3, 4, 5, 6].forEach((c) => (r.getColumn(c).numFmt = moeda));
  r.columns.forEach((c, i) => (c.width = [30, 10, 16, 14, 14, 14][i]));

  const d = wb.addWorksheet("Venda a venda", { views: [{ state: "frozen", ySplit: 1 }] });
  titulo(d, ["Data", "Venda nº", "Cliente", "Vendedor", "Base", "%", "Comissão", "Situação"]);
  for (const l of linhas) {
    d.addRow([new Date(`${l.data}T12:00:00Z`), l.numero, l.cliente ?? "", l.vendedor, l.base, l.percentual / 100, l.valor, l.lancada ? "Lançada" : "A lançar"]);
  }
  d.getColumn(1).numFmt = "dd/mm/yyyy";
  d.getColumn(5).numFmt = moeda;
  d.getColumn(6).numFmt = "0.00%";
  d.getColumn(7).numFmt = moeda;
  d.columns.forEach((c, i) => (c.width = [12, 10, 30, 24, 14, 8, 14, 12][i]));

  const nome = `comissoes-${(acesso.nome_fantasia ?? acesso.razao_social).normalize("NFD").replace(/[^\w]+/g, "-").slice(0, 40)}-${f.inicio}-a-${f.fim}`;
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
