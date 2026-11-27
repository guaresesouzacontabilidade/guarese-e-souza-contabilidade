import "server-only";
import type ExcelJS from "exceljs";
import { dec } from "@/lib/dinheiro";
import { hora } from "@/lib/gestao/rotulos";
import { MOEDA, cabecalhoPlanilha, type InfoPlanilha } from "@/lib/relatorios/excel";
import type { ExtraDoPeriodo } from "./dados";
import { FORMAS_PAGAMENTO_HOTEL, NATUREZAS_EXTRA, UNIDADES_EXTRA, type FormaPagamentoHotel, type NaturezaExtra, type UnidadeExtra } from "./rotulos";

const CINZA = "FF8A817A";

const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * Planilha dos serviços extras do período: uma linha por serviço lançado (na
 * conta do quarto ou no recibo de uma empresa), com os cancelados em cinza e
 * fora dos totais; na segunda aba, o resumo por serviço, por tipo e por origem.
 */
export function planilhaExtras(wb: ExcelJS.Workbook, info: InfoPlanilha, linhas: ExtraDoPeriodo[]) {
  const ws = wb.addWorksheet("Serviços extras");
  cabecalhoPlanilha(
    ws,
    info,
    ["Data", "Hora", "Origem", "Quarto / recibo", "Hóspede / empresa", "Quem pediu", "Serviço", "Tipo", "Quantidade", "Unidade", "Preço unit.", "Total", "Pagamento", "Situação", "Lançado por"],
    [11, 7, 13, 15, 34, 22, 30, 20, 11, 11, 13, 13, 24, 22, 22],
  );
  let total = dec(0);
  for (const l of linhas) {
    const unidade = UNIDADES_EXTRA[l.unidade as UnidadeExtra];
    const forma = l.forma ? ` — ${FORMAS_PAGAMENTO_HOTEL[l.forma as FormaPagamentoHotel] ?? l.forma}` : "";
    const r = ws.addRow([
      dataBR(l.data),
      hora(l.hora),
      l.origem === "hospede" ? "Conta do quarto" : "Empresa",
      l.origem === "hospede" ? `Quarto ${l.quarto ?? ""} · res. ${l.reserva_numero ?? ""}` : `Recibo nº ${l.recibo_numero ?? ""}`,
      l.cliente,
      l.solicitante ?? "",
      l.servico,
      NATUREZAS_EXTRA[l.natureza as NaturezaExtra]?.rotulo ?? l.natureza ?? "",
      l.quantidade,
      unidade ? (l.quantidade === 1 ? unidade.um : unidade.varios) : "",
      l.valor_unitario,
      l.total,
      `${l.pagamento}${forma}`,
      l.cancelado && l.motivo_cancelamento ? `cancelado — ${l.motivo_cancelamento}` : l.situacao,
      l.lancado_por ?? "",
    ]);
    r.getCell(9).numFmt = "#,##0.###";
    r.getCell(11).numFmt = MOEDA;
    r.getCell(12).numFmt = MOEDA;
    if (l.cancelado) r.eachCell((c, n) => (c.font = { color: { argb: CINZA }, strike: n === 12 }));
    else total = total.plus(l.total);
  }
  const t = ws.addRow(["Total (sem os cancelados)", "", "", "", "", "", "", "", "", "", "", total.toNumber()]);
  t.font = { bold: true };
  t.getCell(12).numFmt = MOEDA;
  if (!linhas.length) ws.addRow(["Nenhum serviço extra lançado no período."]);

  // Resumo
  const rs = wb.addWorksheet("Resumo");
  cabecalhoPlanilha(rs, info, ["Agrupamento", "Item", "Quantidade", "Total"], [22, 40, 14, 16]);
  const validos = linhas.filter((l) => !l.cancelado);
  const grupo = (titulo: string, chave: (l: ExtraDoPeriodo) => string, comQuantidade: boolean) => {
    const mapa = new Map<string, { qtd: ReturnType<typeof dec>; total: ReturnType<typeof dec> }>();
    for (const l of validos) {
      const k = chave(l);
      const atual = mapa.get(k) ?? { qtd: dec(0), total: dec(0) };
      mapa.set(k, { qtd: atual.qtd.plus(l.quantidade), total: atual.total.plus(l.total) });
    }
    for (const [k, v] of [...mapa.entries()].sort((a, b) => b[1].total.comparedTo(a[1].total))) {
      const r = rs.addRow([titulo, k, comQuantidade ? v.qtd.toNumber() : "", v.total.toNumber()]);
      r.getCell(3).numFmt = "#,##0.###";
      r.getCell(4).numFmt = MOEDA;
    }
  };
  grupo("Por serviço", (l) => l.servico, true);
  grupo("Por tipo", (l) => NATUREZAS_EXTRA[l.natureza as NaturezaExtra]?.rotulo ?? l.natureza ?? "Outros", false);
  grupo("Por origem", (l) => (l.origem === "hospede" ? "Conta do quarto (hóspedes)" : "Empresas (recibo)"), false);
  const tr = rs.addRow(["Total", "", "", total.toNumber()]);
  tr.font = { bold: true };
  tr.getCell(4).numFmt = MOEDA;
  return ws;
}
