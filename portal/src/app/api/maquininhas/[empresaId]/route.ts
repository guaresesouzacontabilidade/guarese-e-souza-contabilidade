import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { lerCompetencia, ultimoDiaDoMes } from "@/lib/competencia";
import { dadosRequisicao } from "@/lib/requisicao";
import { buscarTudo } from "@/lib/supabase/paginar";
import { ROTULO_CONFERENCIA, ROTULO_MODALIDADE, type Modalidade } from "@/lib/maquininhas/rotulos";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Planilha da conferência das maquininhas do mês: as vendas cobradas acima do
 * contrato (para pedir a devolução à adquirente) e todas as vendas.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/maquininhas/[empresaId]">) {
  const { empresaId } = await ctx.params;
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL(`/login?proximo=${encodeURIComponent(`/e/${empresaId}/maquininhas`)}`, req.url));
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("maquininhas.ver")) return new NextResponse("Acesso negado.", { status: 403 });
  const comp = lerCompetencia(req.nextUrl.searchParams.get("competencia"));
  if (!comp) return new NextResponse("Mês inválido.", { status: 400 });
  const fim = ultimoDiaDoMes(comp);

  const vendas = await buscarTudo(
    (de, ate) =>
      s.supabase
        .from("maquininha_vendas")
        .select(
          "id, data_venda, adquirente_chave, bandeira, modalidade, parcelas, valor_bruto, valor_taxa, valor_liquido, nsu, autorizacao, terminal, data_prevista, situacao, conferencia, taxa_contratada, tarifa_contratada, valor_esperado, diferenca, contrato:maquininha_contratos(adquirente_nome), importacao:maquininha_importacoes(adquirente_nome, nome_arquivo)",
        )
        .eq("empresa_id", empresaId)
        .gte("data_venda", comp)
        .lte("data_venda", fim)
        .order("data_venda")
        .order("id")
        .range(de, ate),
    200_000,
  );

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  const cabecalho = [
    "Data da venda", "Adquirente", "Bandeira", "Tipo de venda", "Parcelas", "Valor da venda", "Taxa cobrada (R$)", "Taxa cobrada (%)",
    "Taxa do contrato (%)", "Tarifa do contrato (R$)", "Taxa pelo contrato (R$)", "Diferença (R$)", "Conferência", "NSU", "Autorização",
    "Terminal", "Previsão de pagamento", "Situação", "Arquivo",
  ];
  const linha = (v: (typeof vendas)[number]) => {
    const bruto = Number(v.valor_bruto);
    const taxa = Number(v.valor_taxa);
    const contrato = v.contrato as { adquirente_nome: string } | null;
    const imp = v.importacao as { adquirente_nome: string | null; nome_arquivo: string | null } | null;
    return [
      new Date(`${v.data_venda}T12:00:00Z`),
      contrato?.adquirente_nome ?? imp?.adquirente_nome ?? v.adquirente_chave,
      v.bandeira ?? "",
      ROTULO_MODALIDADE[v.modalidade as Modalidade] ?? v.modalidade,
      v.parcelas,
      bruto,
      taxa,
      bruto ? taxa / bruto : null,
      v.taxa_contratada !== null ? Number(v.taxa_contratada) / 100 : null,
      v.tarifa_contratada !== null ? Number(v.tarifa_contratada) : null,
      v.valor_esperado !== null ? Number(v.valor_esperado) : null,
      v.diferenca !== null ? Number(v.diferenca) : null,
      ROTULO_CONFERENCIA[v.conferencia]?.rotulo ?? v.conferencia,
      v.nsu ?? "",
      v.autorizacao ?? "",
      v.terminal ?? "",
      v.data_prevista ? new Date(`${v.data_prevista}T12:00:00Z`) : "",
      v.situacao === "aprovada" ? "Aprovada" : v.situacao === "chargeback" ? "Chargeback" : "Cancelada",
      imp?.nome_arquivo ?? "",
    ];
  };
  const planilha = (nome: string, linhas: typeof vendas) => {
    const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(cabecalho);
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A2C1D" } };
    for (const v of linhas) ws.addRow(linha(v));
    [1, 17].forEach((c) => (ws.getColumn(c).numFmt = "dd/mm/yyyy"));
    [6, 7, 10, 11, 12].forEach((c) => (ws.getColumn(c).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00'));
    [8, 9].forEach((c) => (ws.getColumn(c).numFmt = "0.00%"));
    ws.columns.forEach((c, i) => (c.width = [12, 24, 14, 20, 9, 14, 14, 12, 12, 12, 14, 13, 24, 16, 14, 14, 14, 12, 30][i] ?? 14));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabecalho.length } };
  };
  planilha(
    "Acima do contrato",
    vendas.filter((v) => v.conferencia === "acima").sort((a, b) => Number(b.diferenca) - Number(a.diferenca)),
  );
  planilha("Todas as vendas", vendas);
  const buffer = await wb.xlsx.writeBuffer();

  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "exportacao",
    p_entidade: "maquininha_vendas",
    p_empresa_id: empresaId,
    p_detalhes: { competencia: comp.slice(0, 7), vendas: vendas.length },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  const nome = `maquininhas-${(acesso.nome_fantasia ?? acesso.razao_social).normalize("NFD").replace(/[^\w]+/g, "-").slice(0, 40)}-${comp.slice(0, 7)}`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
