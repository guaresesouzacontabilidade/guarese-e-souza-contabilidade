import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { hojeISO } from "@/lib/competencia";
import { dec } from "@/lib/dinheiro";
import { termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";
import { SITUACAO_LANCAMENTO } from "@/lib/rotulos";

const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function csv(valor: unknown) {
  const t = valor === null || valor === undefined ? "" : String(valor);
  // Evita fórmulas maliciosas ao abrir no Excel (CSV injection)
  const seguro = /^[=+\-@\t\r]/.test(t) && !/^-?\d/.test(t) ? `'${t}` : t;
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Exporta os lançamentos filtrados em XLSX ou CSV (padrão brasileiro). */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada.", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const empresaId = sp.get("empresa") ?? "";
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("financeiro.ver")) return new NextResponse("Acesso negado.", { status: 403 });

  const hoje = hojeISO();
  const tipo = sp.get("tipo");
  const situacao = sp.get("situacao");
  const revisao = sp.get("revisao");
  const coluna = sp.get("por") === "competencia" ? "data_competencia" : "data_vencimento";
  const inicio = DATA.test(sp.get("inicio") ?? "") ? sp.get("inicio")! : null;
  const fim = DATA.test(sp.get("fim") ?? "") ? sp.get("fim")! : null;
  const categoria = UUID.test(sp.get("categoria") ?? "") ? sp.get("categoria") : null;
  const contraparte = UUID.test(sp.get("contraparte") ?? "") ? sp.get("contraparte") : null;
  const busca = termoBusca(sp.get("busca"));

  const linhas = await buscarTudo((de, ate) => {
    let q = s.supabase
      .from("lancamentos")
      .select(
        "tipo, descricao, data_competencia, data_vencimento, valor_previsto, valor_baixado, valor_realizado, data_ultimo_pagamento, situacao, status_revisao, numero_documento, observacoes, categoria:categorias_financeiras(codigo, nome), contraparte:contrapartes(nome, documento), centro:centros_custo(nome), projeto:projetos(nome)",
      )
      .eq("empresa_id", empresaId)
      .order(coluna)
      .range(de, ate);
    if (tipo === "receber" || tipo === "pagar") q = q.eq("tipo", tipo);
    if (situacao === "atrasado") q = q.in("situacao", ["aberto", "parcial"]).lt("data_vencimento", hoje);
    else if (situacao === "em_aberto") q = q.in("situacao", ["aberto", "parcial"]);
    else if (situacao && ["aberto", "parcial", "quitado", "cancelado"].includes(situacao)) q = q.eq("situacao", situacao);
    else q = q.neq("situacao", "cancelado");
    if (revisao === "sugerido" || revisao === "confirmado") q = q.eq("status_revisao", revisao);
    if (inicio) q = q.gte(coluna, inicio);
    if (fim) q = q.lte(coluna, fim);
    if (categoria) q = q.eq("categoria_id", categoria);
    if (contraparte) q = q.eq("contraparte_id", contraparte);
    if (busca) q = q.or(`descricao.ilike.%${busca}%,numero_documento.ilike.%${busca}%`);
    return q;
  }, 50000);

  const cabecalho = [
    "Tipo", "Descrição", "Categoria", "Cliente/Fornecedor", "CPF/CNPJ", "Competência", "Vencimento", "Valor", "Pago/recebido (principal)",
    "Em aberto", "Movimentado (com juros/taxas)", "Último pagamento", "Situação", "Revisão", "Nº documento", "Centro de custo", "Projeto", "Observações",
  ];
  const dados = linhas.map((l) => {
    const cat = l.categoria as { codigo: string; nome: string } | null;
    const cp = l.contraparte as { nome: string; documento: string | null } | null;
    const atrasado = ["aberto", "parcial"].includes(l.situacao) && l.data_vencimento < hoje;
    return [
      l.tipo === "receber" ? "A receber" : "A pagar",
      l.descricao,
      cat ? `${cat.codigo} ${cat.nome}` : "",
      cp?.nome ?? "",
      cp?.documento ?? "",
      l.data_competencia,
      l.data_vencimento,
      dec(l.valor_previsto).toNumber(),
      dec(l.valor_baixado).toNumber(),
      dec(l.valor_previsto).minus(dec(l.valor_baixado)).toNumber(),
      dec(l.valor_realizado).toNumber(),
      l.data_ultimo_pagamento ?? "",
      atrasado ? "Vencido" : SITUACAO_LANCAMENTO[l.situacao]?.rotulo ?? l.situacao,
      l.status_revisao === "sugerido" ? "Sugerido (não revisado)" : "Confirmado",
      l.numero_documento ?? "",
      (l.centro as { nome: string } | null)?.nome ?? "",
      (l.projeto as { nome: string } | null)?.nome ?? "",
      l.observacoes ?? "",
    ];
  });
  const nomeBase = `lancamentos-${(acesso.nome_fantasia ?? acesso.razao_social).normalize("NFD").replace(/[^\w]+/g, "-").slice(0, 40)}-${hoje}`;

  if (sp.get("formato") === "csv") {
    const conteudo = [cabecalho, ...dados]
      .map((l) => l.map((v) => (typeof v === "number" ? v.toFixed(2).replace(".", ",") : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v).split("-").reverse().join("/") : csv(v))).join(";"))
      .join("\r\n");
    return new NextResponse(`﻿${conteudo}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nomeBase}.csv"`, "Cache-Control": "no-store" },
    });
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  const ws = wb.addWorksheet("Lançamentos", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(cabecalho);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A2C1D" } };
  for (const d of dados) {
    ws.addRow(d.map((v, i) => ([5, 6, 11].includes(i) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : v)));
  }
  [5, 6, 11].forEach((c) => (ws.getColumn(c + 1).numFmt = "dd/mm/yyyy"));
  [7, 8, 9, 10].forEach((c) => (ws.getColumn(c + 1).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00'));
  ws.columns.forEach((c, i) => (c.width = [10, 40, 30, 30, 18, 12, 12, 14, 16, 14, 16, 14, 14, 18, 16, 18, 18, 30][i] ?? 15));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabecalho.length } };
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeBase}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
