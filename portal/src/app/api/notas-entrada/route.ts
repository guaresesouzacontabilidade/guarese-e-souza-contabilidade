import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { lerCompetencia, somarMeses } from "@/lib/competencia";
import { dadosRequisicao } from "@/lib/requisicao";
import { buscarTudo } from "@/lib/supabase/paginar";
import { formatarCnpj, formatarCompetencia } from "@/lib/formatos";
import { ROTULO_TIPO_ENTRADA, mesclarEntradas, totaisPorEmpresa, type FiscalEntrada, type LinhaEntrada, type ResumoEntrada } from "@/lib/fiscal/nfe-entrada";

const UUID = /^[0-9a-f-]{36}$/i;
/** O escritório fica em Tocantins (UTC−3, sem horário de verão). */
const FUSO = "-03:00";

/**
 * Planilha das NF-e de entrada do mês (pela data de emissão): de uma empresa
 * (?empresa=) ou de todas as empresas que a pessoa vê. Junta os resumos que a
 * SEFAZ entregou e as notas com o XML completo no portal; cada linha diz se o
 * XML completo já está disponível. O acesso segue as regras do banco (RLS).
 */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  const comp = lerCompetencia(req.nextUrl.searchParams.get("competencia"));
  if (!comp) return new NextResponse("Mês inválido.", { status: 400 });
  const empresaParam = req.nextUrl.searchParams.get("empresa");
  if (empresaParam && !UUID.test(empresaParam)) return new NextResponse("Empresa inválida.", { status: 400 });

  const empresas = (await obterEmpresasDoUsuario()).filter((e) => e.permissoes.has("documentos.ver") && (!empresaParam || e.id === empresaParam));
  if (!empresas.length) return new NextResponse("Acesso negado.", { status: 403 });
  const ids = new Set(empresas.map((e) => e.id));
  const proximo = somarMeses(comp, 1);
  // Uma empresa: filtra no banco. Carteira: o banco (RLS) já limita às empresas da pessoa; aqui fica só quem pode ver documentos
  const filtrar = <Q extends { eq: (coluna: string, valor: string) => Q }>(q: Q) => (empresaParam ? q.eq("empresa_id", empresaParam) : q);

  const [resumos, fiscais] = await Promise.all([
    buscarTudo<ResumoEntrada>(
      (de, ate) =>
        filtrar(
          s.supabase
            .from("nfe_resumos")
            .select("empresa_id, chave, emitente_documento, emitente_nome, emitente_ie, data_emissao, tipo_operacao, valor, situacao, ciencia_em, ciencia_retorno, documento_id"),
        )
          .gte("data_emissao", `${comp}T00:00:00${FUSO}`)
          .lt("data_emissao", `${proximo}T00:00:00${FUSO}`)
          .order("data_emissao")
          .order("chave")
          .range(de, ate),
      200_000,
    ),
    buscarTudo<FiscalEntrada>(
      (de, ate) =>
        filtrar(
          s.supabase
            .from("documentos_fiscais")
            .select(
              "empresa_id, documento_id, chave_acesso, numero, serie, data_emissao, emitente_documento, emitente_nome, emitente_uf, emitente_ie, destinatario_documento, destinatario_nome, destinatario_uf, tp_nf, valor_total, cancelada_evento, situacao_arquivo, natureza_operacao, cfops, documento:documentos!inner(excluido_em)",
            ),
        )
          .eq("operacao", "entrada")
          .eq("modelo", "55")
          .eq("competencia", comp)
          .is("documento.excluido_em", null)
          .order("data_emissao")
          .order("id")
          .range(de, ate) as unknown as PromiseLike<{ data: FiscalEntrada[] | null; error: { message: string } | null }>,
      200_000,
    ),
  ]);

  const ordem = new Map(empresas.map((e, i) => [e.id, i]));
  const porId = new Map(empresas.map((e) => [e.id, e]));
  const linhas = mesclarEntradas(
    resumos.filter((r) => ids.has(r.empresa_id)),
    fiscais.filter((f) => ids.has(f.empresa_id)),
    new Map(empresas.map((e) => [e.id, e.documento])),
  ).sort(
    (a, b) => (ordem.get(a.empresaId) ?? 0) - (ordem.get(b.empresaId) ?? 0),
  );
  const nomeEmpresa = (id: string) => {
    const e = porId.get(id);
    return e ? (e.nome_fantasia ?? e.razao_social) : "";
  };

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  const titulo = (ws: import("exceljs").Worksheet, colunas: number) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A2C1D" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas } };
  };

  const ws = wb.addWorksheet("NF-e de entrada", { views: [{ state: "frozen", ySplit: 1 }] });
  const cabecalho = [
    "Empresa", "CNPJ da empresa", "Emissão", "Número", "Série", "Fornecedor / outra parte", "CNPJ/CPF", "Inscrição estadual", "UF",
    "Valor (R$)", "Situação", "Tipo", "XML completo no portal", "Ciência da emissão", "Chave de acesso", "Natureza da operação", "CFOPs",
  ];
  ws.addRow(cabecalho);
  const textoCiencia = (l: LinhaEntrada) =>
    l.ciencia === "registrada" ? "Registrada" : l.ciencia === "recusada" ? `Recusada (${l.cienciaDetalhe ?? ""})` : l.ciencia === "pendente" ? "Não registrada" : "—";
  for (const l of linhas) {
    const e = porId.get(l.empresaId);
    ws.addRow([
      nomeEmpresa(l.empresaId),
      e?.documento ? formatarCnpj(e.documento) : "",
      l.emissao ? new Date(l.emissao) : "",
      l.numero ? Number(l.numero) : "",
      l.serie ?? "",
      l.fornecedor ?? "",
      l.fornecedorDocumento ? formatarCnpj(l.fornecedorDocumento) : "",
      l.fornecedorIe ?? "",
      l.fornecedorUf ?? "",
      l.valor,
      l.situacao,
      ROTULO_TIPO_ENTRADA[l.tipo],
      l.xmlCompleto ? "Sim" : "Não (só resumo)",
      textoCiencia(l),
      l.chave ?? "",
      l.natureza ?? "",
      l.cfops ?? "",
    ]);
  }
  ws.getColumn(3).numFmt = "dd/mm/yyyy";
  ws.getColumn(10).numFmt = '"R$" #,##0.00';
  ws.getColumn(15).numFmt = "@";
  ws.columns.forEach((c, i) => (c.width = [30, 20, 12, 10, 7, 36, 21, 18, 6, 14, 14, 30, 18, 20, 48, 30, 14][i] ?? 14));
  titulo(ws, cabecalho.length);

  const wr = wb.addWorksheet("Resumo por empresa", { views: [{ state: "frozen", ySplit: 1 }] });
  const cabResumo = ["Empresa", "CNPJ", "Notas", "Valor das autorizadas (R$)", "Com XML completo", "Só resumo", "Canceladas ou não autorizadas"];
  wr.addRow(cabResumo);
  const totais = totaisPorEmpresa(linhas);
  for (const e of empresas) {
    const t = totais.get(e.id);
    if (!t && !e.ativa) continue;
    wr.addRow([e.nome_fantasia ?? e.razao_social, e.documento ? formatarCnpj(e.documento) : "", t?.notas ?? 0, t?.valor ?? 0, t?.comXml ?? 0, t?.soResumo ?? 0, t?.canceladas ?? 0]);
  }
  wr.getColumn(4).numFmt = '"R$" #,##0.00';
  wr.columns.forEach((c, i) => (c.width = [36, 20, 8, 22, 16, 11, 26][i] ?? 14));
  titulo(wr, cabResumo.length);
  wr.addRow([]);
  wr.addRow([`NF-e de entrada emitidas em ${formatarCompetencia(comp, true)}. "Só resumo": a SEFAZ entrega o XML completo depois da ciência da emissão.`]);

  const buffer = await wb.xlsx.writeBuffer();
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "exportacao",
    p_entidade: "nfe_entrada",
    p_empresa_id: empresaParam ?? undefined,
    p_detalhes: { competencia: comp.slice(0, 7), notas: linhas.length, empresas: empresas.length },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  const alvo = empresaParam ? nomeEmpresa(empresaParam) : "carteira";
  const nome = `nfe-entrada-${alvo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${comp.slice(0, 7)}`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
