import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { competenciaAtual, hojeISO } from "@/lib/competencia";
import { formatarCompetencia, formatarDocumento } from "@/lib/formatos";
import { periodoMensal } from "@/lib/relatorios/calculos";
import { RELATORIOS, carregarAging, carregarDre, carregarFluxo, carregarSaldos, lerTipoRelatorio } from "@/lib/relatorios/dados";
import { secoesAging, secoesDre, secoesFluxo, secoesSaldos, type Secao } from "@/lib/relatorios/tabelas";
import { gerarPdf, gerarXlsx, nomeArquivo } from "@/lib/relatorios/exportacao";

const UUID = /^[0-9a-f-]{36}$/i;

/** Exporta um relatório gerencial da empresa em Excel ou PDF. */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada.", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const empresaId = sp.get("empresa") ?? "";
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("relatorios.ver") || !acesso.permissoes.has("financeiro.ver")) {
    return new NextResponse("Acesso negado.", { status: 403 });
  }

  const hoje = hojeISO();
  const relatorio = lerTipoRelatorio(sp.get("relatorio"));
  const { inicio, fim } = periodoMensal(sp.get("de") ?? undefined, sp.get("ate") ?? undefined, competenciaAtual());
  const formato = sp.get("formato") === "pdf" ? "pdf" : "xlsx";

  let secoes: Secao[];
  try {
    switch (relatorio) {
      case "dre":
        secoes = secoesDre(await carregarDre(s.supabase, empresaId, inicio, fim));
        break;
      case "contas":
        secoes = secoesAging(await carregarAging(s.supabase, empresaId, hoje), hoje);
        break;
      case "saldos": {
        const d = await carregarSaldos(s.supabase, empresaId, inicio, fim, hoje);
        secoes = secoesSaldos(d.contas, d.dataInicial, d.dataFinal, d.evolucao);
        break;
      }
      default:
        secoes = secoesFluxo(await carregarFluxo(s.supabase, empresaId, inicio, fim));
    }
  } catch {
    return new NextResponse("Não foi possível gerar o relatório. Tente novamente.", { status: 500 });
  }

  const empresa = acesso.nome_fantasia ?? acesso.razao_social;
  const periodo =
    relatorio === "contas" ? `posição em ${hoje.split("-").reverse().join("/")}` : inicio === fim ? formatarCompetencia(inicio, true) : `${formatarCompetencia(inicio, true)} a ${formatarCompetencia(fim, true)}`;
  const titulo = `${RELATORIOS[relatorio]} — ${empresa}`;
  const subtitulo = `${acesso.razao_social} · ${formatarDocumento(acesso.documento)} · ${periodo}`;
  const nome = nomeArquivo([relatorio, empresa.slice(0, 40), relatorio === "contas" ? hoje : `${inicio.slice(0, 7)}_${fim.slice(0, 7)}`]);
  const cabecalhos = (tipo: string, ext: string) => ({
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${nome}.${ext}"`,
    "Cache-Control": "no-store",
  });

  if (formato === "pdf") {
    const pdf = await gerarPdf(titulo, subtitulo, secoes);
    return new NextResponse(new Uint8Array(pdf), { headers: cabecalhos("application/pdf", "pdf") });
  }
  const xlsx = await gerarXlsx(titulo, subtitulo, secoes);
  return new NextResponse(xlsx, { headers: cabecalhos("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
}
