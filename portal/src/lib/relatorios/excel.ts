import "server-only";
import ExcelJS from "exceljs";
import { dec } from "@/lib/dinheiro";
import type { ResultadoDre } from "./dre";
import { GRUPOS_FLUXO, type Projecao, type ResultadoFluxo } from "./fluxo";
import type { Indicador } from "./indicadores";
import { rotuloMesCurto } from "./periodo";

/** Planilhas dos relatórios (valores como números, formato de moeda brasileiro). */
const MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"—"';
const MARROM = "FF4A2C1D";
const BEGE = "FFF1E8DC";

export interface InfoPlanilha {
  titulo: string;
  empresa: string;
  periodo: string;
  situacao: string;
  geradoEm: string;
}

export function novaPasta() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  wb.created = new Date();
  return wb;
}

function cabecalho(ws: ExcelJS.Worksheet, info: InfoPlanilha, colunas: string[], larguras: number[]) {
  ws.addRow([info.titulo]).font = { bold: true, size: 14, color: { argb: MARROM } };
  ws.addRow([`${info.empresa} — ${info.periodo}`]).font = { size: 10 };
  ws.addRow([`${info.situacao} · gerado em ${info.geradoEm}`]).font = { size: 9, italic: true, color: { argb: "FF6B625B" } };
  ws.addRow([]);
  const r = ws.addRow(colunas);
  r.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARROM } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  r.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  larguras.forEach((l, i) => (ws.getColumn(i + 1).width = l));
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];
}

const num = (v: string | number | null | undefined) => dec(v ?? 0).toNumber();

export function planilhaDre(wb: ExcelJS.Workbook, info: InfoPlanilha, dre: ResultadoDre) {
  const ws = wb.addWorksheet("Resultado (DRE)");
  const varios = dre.meses.length > 1;
  cabecalho(ws, info, ["Descrição", ...(varios ? dre.meses.map(rotuloMesCurto) : []), "Total", "% da receita"], [52, ...(varios ? dre.meses.map(() => 15) : []), 16, 12]);
  for (const l of dre.linhas) {
    const r = ws.addRow([
      `${l.nivel === 1 ? "    " : ""}${l.rotulo}`,
      ...(varios ? dre.meses.map((m) => num(l.valores[m])) : []),
      num(l.total),
      l.percentual === null ? null : l.percentual / 100,
    ]);
    r.eachCell((c, i) => {
      if (i > 1 && i < r.cellCount) c.numFmt = MOEDA;
      if (i === r.cellCount) c.numFmt = "0.0%";
    });
    if (l.tipo !== "categoria") r.font = { bold: true };
    if (l.tipo === "total") r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BEGE } }));
  }
  return ws;
}

export function planilhaFluxo(wb: ExcelJS.Workbook, info: InfoPlanilha, fluxo: ResultadoFluxo) {
  const ws = wb.addWorksheet("Fluxo de caixa");
  cabecalho(ws, info, ["Movimento", ...fluxo.meses.map((m) => rotuloMesCurto(m.mes))], [46, ...fluxo.meses.map(() => 15)]);
  const linha = (rotulo: string, valores: (string | number)[], negrito = false) => {
    const r = ws.addRow([rotulo, ...valores.map(num)]);
    r.eachCell((c, i) => i > 1 && (c.numFmt = MOEDA));
    if (negrito) r.font = { bold: true };
  };
  linha("Saldo no início", fluxo.meses.map((m) => m.saldoInicial), true);
  for (const g of Object.keys(GRUPOS_FLUXO)) {
    if (!fluxo.meses.some((m) => m.porGrupo[g])) continue;
    linha(`${GRUPOS_FLUXO[g]} — entradas`, fluxo.meses.map((m) => m.porGrupo[g]?.entradas ?? 0));
    linha(`${GRUPOS_FLUXO[g]} — saídas`, fluxo.meses.map((m) => dec(m.porGrupo[g]?.saidas ?? 0).negated().toFixed(2)));
  }
  if (fluxo.meses.some((m) => !dec(m.abertura).isZero())) linha("Saldo inicial de contas cadastradas", fluxo.meses.map((m) => m.abertura));
  linha("Saldo no fim", fluxo.meses.map((m) => m.saldoFinal), true);

  const cat = wb.addWorksheet("Fluxo por categoria");
  cabecalho(cat, info, ["Categoria", "Grupo", "Entradas", "Saídas"], [40, 34, 16, 16]);
  for (const c of fluxo.porCategoria) {
    const r = cat.addRow([c.categoria, GRUPOS_FLUXO[c.grupo] ?? c.grupo, num(c.entradas), num(c.saidas)]);
    r.getCell(3).numFmt = MOEDA;
    r.getCell(4).numFmt = MOEDA;
  }
  return ws;
}

export function planilhaProjecao(
  wb: ExcelJS.Workbook,
  info: InfoPlanilha,
  p: Projecao,
  saldoHoje: string,
  linhas: { data: string; vencido: boolean; descricao: string; contraparte: string | null; entrada: number | string; saida: number | string }[],
) {
  const ws = wb.addWorksheet("Previsão de caixa");
  cabecalho(ws, info, ["Data", "Descrição", "Cliente/Fornecedor", "A receber", "A pagar", "Situação"], [14, 44, 30, 15, 15, 12]);
  let saldo = dec(saldoHoje);
  for (const l of [...linhas].sort((a, b) => a.data.localeCompare(b.data))) {
    saldo = saldo.plus(dec(l.entrada)).minus(dec(l.saida));
    const r = ws.addRow([new Date(`${l.data}T12:00:00Z`), l.descricao, l.contraparte ?? "", num(l.entrada), num(l.saida), l.vencido ? "Vencida" : ""]);
    r.getCell(1).numFmt = "dd/mm/yyyy";
    r.getCell(4).numFmt = MOEDA;
    r.getCell(5).numFmt = MOEDA;
  }
  ws.addRow([]);
  ws.addRow(["Saldo disponível hoje", null, null, num(saldoHoje)]).getCell(4).numFmt = MOEDA;
  for (const j of p.janelas) {
    const r = ws.addRow([`Saldo previsto em ${j.dias} dias`, null, null, num(j.saldo)]);
    r.getCell(4).numFmt = MOEDA;
    r.font = { bold: true };
  }
  return ws;
}

export function planilhaIndicadores(wb: ExcelJS.Workbook, info: InfoPlanilha, indicadores: Indicador[], resumo: string[]) {
  const ws = wb.addWorksheet("Indicadores");
  cabecalho(ws, info, ["Indicador", "Valor", "Situação", "O que significa"], [32, 22, 12, 90]);
  const rot = { bom: "Saudável", atencao: "Atenção", critico: "Crítico", sem_dados: "Sem dados" } as const;
  for (const i of indicadores) {
    const r = ws.addRow([i.titulo, i.valor, rot[i.status], `${i.explicacao}${i.detalhe ? ` (${i.detalhe})` : ""}`]);
    r.getCell(4).alignment = { wrapText: true, vertical: "top" };
  }
  ws.addRow([]);
  ws.addRow(["Resumo do período"]).font = { bold: true };
  for (const p of resumo) ws.addRow([p]).getCell(1).alignment = { wrapText: false };
  return ws;
}

export async function bufferPlanilha(wb: ExcelJS.Workbook) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}
