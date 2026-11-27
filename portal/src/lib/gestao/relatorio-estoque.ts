import "server-only";
import type ExcelJS from "exceljs";
import type { Content, TableCell } from "pdfmake/interfaces";
import { Decimal, formatarMoeda } from "@/lib/dinheiro";
import { MOEDA, cabecalhoPlanilha, type InfoPlanilha } from "@/lib/relatorios/excel";
import { COR, tabela } from "@/lib/relatorios/pdf";
import { curvaAbc, custoUnitario, estoquePorGrupo, produtosParados, sugestaoCompra, type ProdutoAnalise, type VendaProduto } from "./analise-estoque";
import { m3PorUnidade } from "./precos";
import { formatarQuantidade, un } from "./rotulos";

/**
 * Relatórios da reposição e análise do estoque: posição do estoque (por grupo,
 * com m³ e valor pelo custo) e lista de compras, em PDF e em Excel.
 */
export interface DadosRelatorioEstoque {
  produtos: ProdutoAnalise[];
  vendas: Map<string, VendaProduto>;
  ultimaEntrada: Map<string, string | null>;
  hoje: string;
  dias: number;
  alvo: number;
}

const n = (v: Decimal.Value | null | undefined) => (v === null || v === undefined || v === "" ? 0 : new Decimal(v).toNumber());
const direita = (text: string, extra: Partial<TableCell & object> = {}): TableCell => ({ text, alignment: "right", noWrap: true, ...extra }) as TableCell;
const moedaPdf = (v: Decimal) => direita(v.isZero() ? "—" : formatarMoeda(v));

/** Produtos com controle de estoque, por grupo e nome. */
function produtosDaPosicao(produtos: ProdutoAnalise[]) {
  return produtos
    .filter((p) => p.controla_estoque)
    .sort((a, b) => (a.grupo?.trim() || "~").localeCompare(b.grupo?.trim() || "~", "pt-BR") || a.descricao.localeCompare(b.descricao, "pt-BR"));
}

function linhaPosicao(p: ProdutoAnalise) {
  const estoque = new Decimal(p.estoque_atual || 0);
  const custo = custoUnitario(p);
  const m3u = m3PorUnidade(p);
  const m3 = m3u && estoque.gt(0) ? estoque.times(m3u) : null;
  const valor = estoque.gt(0) ? estoque.times(custo) : new Decimal(0);
  return { estoque, custo, m3, valor };
}

// ------------------------------------------------------------------ PDF

export function pdfPosicaoEstoque(d: DadosRelatorioEstoque): Content[] {
  const grupos = estoquePorGrupo(d.produtos);
  const totalValor = grupos.reduce((s, g) => s.plus(g.valor), new Decimal(0));
  const totalM3 = grupos.reduce((s, g) => s.plus(g.m3), new Decimal(0));
  const linhas: TableCell[][] = [];
  const destaques: number[] = [];
  let grupoAtual: string | null = null;
  for (const p of produtosDaPosicao(d.produtos)) {
    const nome = p.grupo?.trim() || "Sem grupo";
    if (nome !== grupoAtual) {
      grupoAtual = nome;
      const g = grupos.find((x) => x.grupo === nome);
      destaques.push(linhas.length + 1);
      linhas.push([
        { text: nome, bold: true, colSpan: 3 },
        {},
        {},
        direita(g && g.m3.gt(0) ? formatarQuantidade(g.m3, 3) : "", { bold: true }),
        {},
        direita(g ? formatarMoeda(g.valor) : "", { bold: true }),
        {},
      ]);
    }
    const l = linhaPosicao(p);
    linhas.push([
      { text: [{ text: p.descricao }, { text: `  ${p.codigo}`, color: COR.cinza, fontSize: 7 }] },
      direita(`${formatarQuantidade(l.estoque, 3)} ${un(p.unidade)}`, l.estoque.lte(0) ? { color: COR.vermelho } : {}),
      direita(p.estoque_minimo ? formatarQuantidade(p.estoque_minimo, 3) : "—"),
      direita(l.m3 ? formatarQuantidade(l.m3, 3) : "—"),
      moedaPdf(l.custo),
      moedaPdf(l.valor),
      direita(p.valor_unitario ? formatarMoeda(p.valor_unitario) : "—"),
    ]);
  }
  destaques.push(linhas.length + 1);
  linhas.push([{ text: "Total do estoque", bold: true, colSpan: 3 }, {}, {}, direita(totalM3.gt(0) ? formatarQuantidade(totalM3, 3) : "—", { bold: true }), {}, direita(formatarMoeda(totalValor), { bold: true }), {}]);
  return [
    {
      columns: [
        { text: [{ text: "Valor do estoque (custo): ", color: COR.cinza }, { text: formatarMoeda(totalValor), bold: true }] },
        ...(totalM3.gt(0) ? [{ text: [{ text: "Madeira em estoque: ", color: COR.cinza }, { text: `${formatarQuantidade(totalM3, 3)} m³`, bold: true }] }] : []),
      ],
      margin: [0, 0, 0, 8],
    } as Content,
    tabela(["Produto", "Estoque", "Mínimo", "m³", "Custo médio", "Valor (custo)", "Preço de venda"], linhas, ["*", 62, 40, 42, 58, 64, 58], { destaques, fontSize: 7.5 }),
  ];
}

export function pdfListaCompras(d: DadosRelatorioEstoque): Content[] {
  const compras = sugestaoCompra(d.produtos, d.vendas, d.dias, d.alvo);
  if (!compras.length) return [{ text: `Nada para comprar: o estoque dá para mais de ${d.alvo} dias no ritmo atual e está acima do mínimo.`, margin: [0, 8, 0, 0] }];
  const total = compras.reduce((s, c) => s.plus(c.valorCompra), new Decimal(0));
  const linhas: TableCell[][] = compras.map((c) => [
    { text: [{ text: c.produto.descricao }, { text: `  ${c.produto.codigo}`, color: COR.cinza, fontSize: 7 }] },
    direita(`${formatarQuantidade(c.produto.estoque_atual, 3)} ${un(c.produto.unidade)}`),
    direita(c.cobertura === null ? "não vendeu" : c.cobertura === 0 ? "acabou" : `${c.cobertura} d`),
    direita(c.media.gt(0) ? formatarQuantidade(c.media, 2) : "—"),
    direita(
      c.comprarNaCompra && c.produto.unidade_compra
        ? `${formatarQuantidade(c.comprarNaCompra, 0)} ${c.produto.unidade_compra} (${formatarQuantidade(c.comprar, 3)} ${un(c.produto.unidade)})`
        : `${formatarQuantidade(c.comprar, 3)} ${un(c.produto.unidade)}`,
      { bold: true },
    ),
    moedaPdf(custoUnitario(c.produto)),
    moedaPdf(c.valorCompra),
    { text: "", margin: [0, 6, 0, 0] },
  ]);
  linhas.push([{ text: "Total estimado (pelo custo)", bold: true, colSpan: 6 }, {}, {}, {}, {}, {}, direita(formatarMoeda(total), { bold: true }), {}]);
  return [
    { text: `Para ter estoque para ${d.alvo} dias no ritmo de venda dos últimos ${d.dias} dias, e nunca menos que o estoque mínimo. A coluna "Pedido" fica livre para anotar.`, style: "nota", margin: [0, 0, 0, 6] },
    tabela(["Produto", "Estoque", "Dura", "Vende/dia", "Comprar", "Custo", "Valor", "Pedido"], linhas, ["*", 58, 40, 42, 58, 52, 58, 40], { destaques: [linhas.length], fontSize: 7.5 }),
  ];
}

// ------------------------------------------------------------------ Excel

function cabecalhoNegrito(ws: ExcelJS.Worksheet) {
  const r = ws.lastRow;
  if (r) r.font = { bold: true };
}

export function planilhasEstoque(wb: ExcelJS.Workbook, info: InfoPlanilha, d: DadosRelatorioEstoque) {
  // Posição do estoque
  const ws = wb.addWorksheet("Posição do estoque");
  cabecalhoPlanilha(ws, { ...info, titulo: "Posição do estoque" }, ["Produto", "Código", "Grupo", "Unidade", "Estoque", "Mínimo", "m³", "Custo médio", "Valor (custo)", "Preço de venda"], [44, 14, 18, 9, 12, 10, 10, 14, 15, 14]);
  let totalValor = new Decimal(0);
  let totalM3 = new Decimal(0);
  for (const p of produtosDaPosicao(d.produtos)) {
    const l = linhaPosicao(p);
    totalValor = totalValor.plus(l.valor);
    if (l.m3) totalM3 = totalM3.plus(l.m3);
    const r = ws.addRow([p.descricao, p.codigo, p.grupo ?? "", un(p.unidade), n(l.estoque), p.estoque_minimo ? n(p.estoque_minimo) : null, l.m3 ? n(l.m3.toDecimalPlaces(4)) : null, n(l.custo), n(l.valor.toDecimalPlaces(2)), p.valor_unitario ? n(p.valor_unitario) : null]);
    for (const c of [8, 9, 10]) r.getCell(c).numFmt = MOEDA;
    r.getCell(7).numFmt = "0.000";
  }
  const t = ws.addRow(["Total", "", "", "", null, null, n(totalM3.toDecimalPlaces(3)), null, n(totalValor.toDecimalPlaces(2)), null]);
  t.font = { bold: true };
  t.getCell(9).numFmt = MOEDA;
  t.getCell(7).numFmt = "0.000";

  // Lista de compras
  const wc = wb.addWorksheet("Lista de compras");
  cabecalhoPlanilha(wc, { ...info, titulo: `Lista de compras — estoque para ${d.alvo} dias (ritmo de ${d.dias} dias)` }, ["Produto", "Código", "Grupo", "Estoque", "Mínimo", "Dura (dias)", "Vende por dia", "Comprar", "Unidade", "Custo", "Valor estimado", "Na unidade de compra"], [44, 14, 18, 12, 10, 12, 13, 12, 9, 13, 15, 20]);
  let totalCompra = new Decimal(0);
  for (const c of sugestaoCompra(d.produtos, d.vendas, d.dias, d.alvo)) {
    totalCompra = totalCompra.plus(c.valorCompra);
    const r = wc.addRow([c.produto.descricao, c.produto.codigo, c.produto.grupo ?? "", n(c.produto.estoque_atual), c.produto.estoque_minimo ? n(c.produto.estoque_minimo) : null, c.cobertura, n(c.media.toDecimalPlaces(3)), n(c.comprar), un(c.produto.unidade), n(custoUnitario(c.produto)), n(c.valorCompra), c.comprarNaCompra && c.produto.unidade_compra ? `${formatarQuantidade(c.comprarNaCompra, 0)} ${c.produto.unidade_compra}` : ""]);
    for (const col of [10, 11]) r.getCell(col).numFmt = MOEDA;
  }
  const tc = wc.addRow(["Total estimado", "", "", null, null, null, null, null, "", null, n(totalCompra)]);
  tc.font = { bold: true };
  tc.getCell(11).numFmt = MOEDA;

  // Parados (60 dias)
  const wp = wb.addWorksheet("Parados 60+ dias");
  cabecalhoPlanilha(wp, { ...info, titulo: "Produtos parados há 60 dias ou mais" }, ["Produto", "Código", "Grupo", "Estoque", "Unidade", "Última venda", "Dias sem vender", "Dinheiro empatado"], [44, 14, 18, 12, 9, 14, 15, 17]);
  for (const p of produtosParados(d.produtos, d.vendas, d.ultimaEntrada, d.hoje, 60)) {
    const r = wp.addRow([p.produto.descricao, p.produto.codigo, p.produto.grupo ?? "", n(p.estoque), un(p.produto.unidade), p.ultimaVenda ? p.ultimaVenda.split("-").reverse().join("/") : "nunca vendeu", p.diasSemVender, n(p.valorParado)]);
    r.getCell(8).numFmt = MOEDA;
  }

  // Curva ABC
  const wa = wb.addWorksheet("Curva ABC");
  cabecalhoPlanilha(wa, { ...info, titulo: `Mais vendidos — curva ABC (últimos ${d.dias} dias)` }, ["Produto", "Código", "Grupo", "Classe", "Vendido", "Unidade", "Faturamento", "Lucro bruto", "% das vendas", "% acumulado"], [44, 14, 18, 8, 12, 9, 15, 15, 12, 12]);
  for (const x of curvaAbc(d.produtos, d.vendas)) {
    const r = wa.addRow([x.produto.descricao, x.produto.codigo, x.produto.grupo ?? "", x.classe, n(x.quantidade), un(x.produto.unidade), n(x.faturamento), n(x.lucro), x.participacao / 100, x.acumulado / 100]);
    for (const col of [7, 8]) r.getCell(col).numFmt = MOEDA;
    for (const col of [9, 10]) r.getCell(col).numFmt = "0.0%";
  }

  // Por grupo
  const wg = wb.addWorksheet("Por grupo");
  cabecalhoPlanilha(wg, { ...info, titulo: "Estoque por grupo" }, ["Grupo", "Produtos", "Sem estoque", "Quantidade", "m³", "Valor (custo)"], [24, 10, 12, 36, 10, 16]);
  for (const g of estoquePorGrupo(d.produtos)) {
    const r = wg.addRow([g.grupo, g.produtos, g.semEstoque, Object.entries(g.quantidades).map(([u, q]) => `${formatarQuantidade(q, 3)} ${un(u)}`).join(" + "), n(g.m3), n(g.valor)]);
    r.getCell(5).numFmt = "0.000";
    r.getCell(6).numFmt = MOEDA;
  }
  cabecalhoNegrito(wg);
}
