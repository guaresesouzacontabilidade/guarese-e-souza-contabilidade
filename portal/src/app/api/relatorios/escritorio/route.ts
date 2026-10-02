import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi, ehEquipe } from "@/lib/auth/sessao";
import { competenciaAtual, hojeISO } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { periodoMensal } from "@/lib/relatorios/calculos";
import { ABAS_ESCRITORIO, carregarRelatorioEscritorio, lerAbaEscritorio, secoesEscritorio } from "@/lib/relatorios/escritorio-dados";
import { gerarPdf, gerarXlsx, nomeArquivo } from "@/lib/relatorios/exportacao";

const UUID = /^[0-9a-f-]{36}$/i;

/** Exporta os relatórios operacionais do escritório (somente equipe). */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada.", { status: 401 });
  if (!ehEquipe(s.perfil)) return new NextResponse("Acesso negado.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const hoje = hojeISO();
  const aba = lerAbaEscritorio(sp.get("aba"));
  const { inicio, fim } = periodoMensal(sp.get("de") ?? undefined, sp.get("ate") ?? undefined, competenciaAtual());
  const responsavel = UUID.test(sp.get("responsavel") ?? "") ? sp.get("responsavel")! : "";
  const situacao = sp.get("situacao") === "todas" ? "todas" : "ativas";

  let dados;
  try {
    dados = await carregarRelatorioEscritorio(s.supabase, { inicio, fim, responsavel, situacao }, hoje);
  } catch {
    return new NextResponse("Não foi possível gerar o relatório. Tente novamente.", { status: 500 });
  }
  const secoes = secoesEscritorio(dados, aba);
  const periodo = inicio === fim ? formatarCompetencia(inicio, true) : `${formatarCompetencia(inicio, true)} a ${formatarCompetencia(fim, true)}`;
  const titulo = `${ABAS_ESCRITORIO[aba]} — carteira do escritório`;
  const subtitulo = `${aba === "pendencias" ? `Posição em ${hoje.split("-").reverse().join("/")}` : periodo} · ${dados.empresas.length} empresa(s)${
    situacao === "ativas" ? " ativas" : ""
  }`;
  const nome = nomeArquivo(["escritorio", aba, aba === "pendencias" ? hoje : `${inicio.slice(0, 7)}_${fim.slice(0, 7)}`]);
  const cabecalhos = (tipo: string, ext: string) => ({
    "Content-Type": tipo,
    "Content-Disposition": `attachment; filename="${nome}.${ext}"`,
    "Cache-Control": "no-store",
  });

  if (sp.get("formato") === "pdf") {
    const pdf = await gerarPdf(titulo, subtitulo, secoes);
    return new NextResponse(new Uint8Array(pdf), { headers: cabecalhos("application/pdf", "pdf") });
  }
  const xlsx = await gerarXlsx(titulo, subtitulo, secoes);
  return new NextResponse(xlsx, { headers: cabecalhos("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
}
