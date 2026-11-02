import { NextResponse, type NextRequest } from "next/server";
import type ExcelJS from "exceljs";
import { ehEquipe, sessaoApi } from "@/lib/auth/sessao";
import { competenciaAtual, hojeISO, lerCompetencia } from "@/lib/competencia";
import { formatarCompetencia, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { logosDaEmpresa } from "@/lib/marca/logos-relatorio";
import { ETAPAS_MAPA, SITUACOES_MAPA, STATUS_MAPA, diaMes, montarEmpresaMapa, PESO_SITUACAO, type LinhaMapaBanco, type StatusEtapa } from "@/lib/operacional/mapa";
import { bufferPlanilha, cabecalhoPlanilha, novaPasta } from "@/lib/relatorios/excel";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

const COR: Record<StatusEtapa, string> = {
  ok: "FFE7F7EC",
  andamento: "FFE0F6FA",
  afazer: "FFEEF1FA",
  perto: "FFFEF3DC",
  atraso: "FFFDE8EE",
  cliente: "FFEFEAFE",
  na: "FFFFFFFF",
};

/** Planilha (Excel) do mapa da carteira de uma competência (?competencia=AAAA-MM). Só a equipe. */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  if (!ehEquipe(s.perfil)) return new NextResponse("Acesso negado.", { status: 403 });
  const comp = lerCompetencia(req.nextUrl.searchParams.get("competencia"));
  if (!comp) return new NextResponse("Informe a competência.", { status: 400 });
  try {
    const { data, error } = await s.supabase.rpc("operacional_mapa", { p_competencia: comp });
    if (error) throw error;
    const hoje = hojeISO();
    const empresas = ((data ?? []) as LinhaMapaBanco[])
      .map((l) => montarEmpresaMapa(l, comp, hoje, competenciaAtual()))
      .sort((a, b) => PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao] || a.nome.localeCompare(b.nome, "pt-BR"));

    const wb = novaPasta();
    const ws: ExcelJS.Worksheet = wb.addWorksheet("Mapa da carteira");
    const colunas = ["Empresa", "CNPJ/CPF", "Regime", "Responsável", "Situação", ...ETAPAS_MAPA.map((e) => e.nome), "Etapas concluídas", "Próximo prazo"];
    cabecalhoPlanilha(
      ws,
      {
        titulo: "Mapa da carteira",
        empresa: "Carteira do escritório",
        periodo: formatarCompetencia(comp, true),
        situacao: `${empresas.length} empresa(s)`,
        geradoEm: formatarDataHora(new Date().toISOString()),
        logos: await logosDaEmpresa(s.supabase, null),
      },
      colunas,
      [34, 20, 18, 20, 18, 22, 22, 22, 22, 22, 22, 14, 26],
    );
    for (const e of empresas) {
      const r = ws.addRow([
        e.nome,
        formatarDocumento(e.documento),
        e.regime,
        e.responsavel ?? "Sem responsável",
        SITUACOES_MAPA[e.situacao],
        ...e.etapas.map((et) => `${STATUS_MAPA[et.status]}: ${et.texto}`),
        `${e.feitas} de ${e.total}`,
        e.prazo ? `${diaMes(e.prazo.data)} · ${e.prazo.oque}` : "—",
      ]);
      e.etapas.forEach((et, j) => {
        const c = r.getCell(6 + j);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR[et.status] } };
        c.alignment = { wrapText: true, vertical: "top" };
        c.note = et.detalhe;
      });
      r.alignment = { vertical: "top", wrapText: true };
    }
    const nome = nomeArquivo(["mapa-da-carteira", comp.slice(0, 7)], "xlsx");
    return new NextResponse(new Uint8Array(await bufferPlanilha(wb)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar a planilha do mapa da carteira", e);
    return new NextResponse("Não foi possível gerar a planilha. Tente novamente.", { status: 500 });
  }
}
