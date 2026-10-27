import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { buscarTudo } from "@/lib/supabase/paginar";
import { CAMPOS_PLANILHA } from "@/lib/gestao/planilha-produtos";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Planilha de produtos da loja: o modelo em branco (?tipo=modelo) ou os
 * produtos atuais (?tipo=atuais) no mesmo formato, para mudar preços e
 * estoque em lote e enviar de volta. Só para quem gerencia a loja da empresa.
 */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  const empresaId = req.nextUrl.searchParams.get("empresa") ?? "";
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const empresa = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!empresa || !empresa.loja || empresa.gestao_modalidade === "notas" || !empresa.permissoes.has("gestao.gerenciar")) {
    return new NextResponse("Acesso negado.", { status: 403 });
  }
  const atuais = req.nextUrl.searchParams.get("tipo") === "atuais";

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  const ws = wb.addWorksheet("Produtos", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(CAMPOS_PLANILHA.map((c) => c.titulo));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A2C1D" } };
  ws.columns.forEach((c, i) => (c.width = [14, 42, 12, 10, 16, 16, 12, 16, 18, 24, 12][i] ?? 14));
  // Texto nas colunas de código (mantém os zeros à esquerda)
  for (const i of [1, 3, 10, 11]) ws.getColumn(i).numFmt = "@";

  if (atuais) {
    const produtos = await buscarTudo((de, ate) =>
      s.supabase
        .from("nfe_produtos")
        .select("codigo, descricao, ncm, unidade, valor_unitario, preco_custo, estoque_atual, estoque_minimo, grupo, gtin, cest, controla_estoque")
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .order("descricao")
        .range(de, ate),
    );
    for (const p of produtos) {
      ws.addRow([
        p.codigo,
        p.descricao,
        p.ncm,
        p.unidade,
        p.valor_unitario == null ? null : Number(p.valor_unitario),
        p.preco_custo == null ? null : Number(p.preco_custo),
        p.controla_estoque ? Number(p.estoque_atual) : null,
        p.estoque_minimo == null ? null : Number(p.estoque_minimo),
        p.grupo,
        p.gtin,
        p.cest,
      ]);
    }
  } else {
    ws.addRow(["", "Tábua de pinus 30 cm x 3 m (exemplo)", "44071100", "UN", 42.9, 28.5, 120, 20, "Tábuas", "", ""]);
    ws.addRow(["", "Prego 17x27 (exemplo)", "73170020", "KG", 25, 14, 40, 10, "Fixação", "", ""]);
  }

  const ajuda = wb.addWorksheet("Como preencher");
  ajuda.columns = [
    { header: "Coluna", width: 26 },
    { header: "Como preencher", width: 110 },
  ];
  ajuda.getRow(1).font = { bold: true };
  for (const c of CAMPOS_PLANILHA) ajuda.addRow([c.titulo, c.ajuda]);
  ajuda.addRow([]);
  ajuda.addRow(["Dica", "Apague as linhas de exemplo. Uma linha por produto. Produto com o código de um já cadastrado é atualizado (só as colunas preenchidas mudam)."]);
  ajuda.addRow(["", "Envie em Loja → Produtos e estoque → Importar planilha. O portal mostra o que vai mudar antes de gravar."]);

  const buffer = await wb.xlsx.writeBuffer();
  const nome = atuais ? "produtos-da-loja" : "modelo-produtos-estoque";
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
