import { NextResponse, type NextRequest } from "next/server";
import type { Content } from "pdfmake/interfaces";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { hojeISO, somarDias } from "@/lib/competencia";
import { formatarDataHora } from "@/lib/formatos";
import { carregarDre, carregarFluxo, carregarPainel, carregarProjecao } from "@/lib/relatorios/dados";
import { lerPeriodo } from "@/lib/relatorios/periodo";
import { montarCabecalho, nomeArquivo, situacaoPeriodo } from "@/lib/relatorios/cabecalho";
import { blocoDre, blocoFluxo, blocoIndicadores, blocoProjecao, gerarPdf } from "@/lib/relatorios/pdf";
import { bufferPlanilha, novaPasta, planilhaDre, planilhaFluxo, planilhaIndicadores, planilhaProjecao } from "@/lib/relatorios/excel";

export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;
const TITULOS = { painel: "Saúde financeira", dre: "Resultado do período (DRE)", fluxo: "Fluxo de caixa" } as const;

/** Exporta o painel, a DRE ou o fluxo de caixa (dados atuais) em PDF ou Excel. */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const sp = req.nextUrl.searchParams;
  const empresaId = sp.get("empresa") ?? "";
  const tipo = sp.get("tipo") as keyof typeof TITULOS;
  const formato = sp.get("formato") === "xlsx" ? "xlsx" : "pdf";
  if (!UUID.test(empresaId) || !(tipo in TITULOS)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("financeiro.ver")) return new NextResponse("Acesso negado.", { status: 403 });

  const hoje = hojeISO();
  const periodo = lerPeriodo(sp.get("periodo"), hoje);
  const centro = UUID.test(sp.get("centro") ?? "") ? sp.get("centro")! : undefined;
  const projeto = UUID.test(sp.get("projeto") ?? "") ? sp.get("projeto")! : undefined;
  const situacao = await situacaoPeriodo(s.supabase, empresaId, periodo.inicio, periodo.fim);
  const titulo = TITULOS[tipo];
  const empresaNome = acesso.nome_fantasia || acesso.razao_social;

  try {
    let arquivo: Buffer;
    if (formato === "pdf") {
      const blocos: Content[] = [];
      if (tipo === "painel") {
        const p = await carregarPainel(s.supabase, empresaId, periodo, hoje);
        const proximas = (await carregarProjecao(s.supabase, empresaId, hoje, 30)).linhas.filter((l) => l.data <= somarDias(hoje, 30));
        blocos.push(...blocoIndicadores(p.indicadores, p.resumo), ...blocoDre(p.dre, periodo.rotulo), ...blocoProjecao(p.projecao, p.saldoHoje, proximas));
      } else if (tipo === "dre") {
        blocos.push(...blocoDre(await carregarDre(s.supabase, empresaId, periodo.inicio, periodo.fim, { centro, projeto }), periodo.rotulo));
      } else {
        const [fluxo, prev] = await Promise.all([carregarFluxo(s.supabase, empresaId, periodo.inicio, periodo.fim), carregarProjecao(s.supabase, empresaId, hoje, 90)]);
        blocos.push(...blocoFluxo(fluxo), ...blocoProjecao(prev.projecao, prev.saldoHoje, prev.linhas.filter((l) => l.data <= somarDias(hoje, 30))));
      }
      const cab = await montarCabecalho(s.supabase, empresaId, {
        titulo,
        subtitulo: `${periodo.rotulo}${centro || projeto ? " — filtrado por centro de custo/projeto" : ""}`,
        situacao,
      });
      arquivo = await gerarPdf(cab, blocos);
    } else {
      const wb = novaPasta();
      const info = {
        titulo,
        empresa: acesso.razao_social,
        periodo: periodo.rotulo,
        situacao: situacao === "revisado" ? "Revisado pelo escritório" : "Preliminar — os números ainda podem mudar",
        geradoEm: formatarDataHora(new Date().toISOString()),
      };
      if (tipo === "painel") {
        const p = await carregarPainel(s.supabase, empresaId, periodo, hoje);
        const prev = await carregarProjecao(s.supabase, empresaId, hoje, 90);
        planilhaIndicadores(wb, info, p.indicadores, p.resumo);
        planilhaDre(wb, info, p.dre);
        planilhaProjecao(wb, info, prev.projecao, prev.saldoHoje, prev.linhas);
      } else if (tipo === "dre") {
        planilhaDre(wb, info, await carregarDre(s.supabase, empresaId, periodo.inicio, periodo.fim, { centro, projeto }));
      } else {
        const [fluxo, prev] = await Promise.all([carregarFluxo(s.supabase, empresaId, periodo.inicio, periodo.fim), carregarProjecao(s.supabase, empresaId, hoje, 90)]);
        planilhaFluxo(wb, info, fluxo);
        planilhaProjecao(wb, info, prev.projecao, prev.saldoHoje, prev.linhas);
      }
      arquivo = await bufferPlanilha(wb);
    }

    await s.supabase.rpc("registrar_evento", {
      p_acao: "exportacao",
      p_entidade: "relatorios",
      p_entidade_id: empresaId,
      p_empresa_id: empresaId,
      p_detalhes: { tipo, formato, periodo: periodo.chave },
    });
    const nome = nomeArquivo([tipo === "painel" ? "saude-financeira" : tipo, empresaNome, periodo.chave], formato);
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao exportar relatório", e);
    return new NextResponse("Não foi possível gerar o arquivo. Tente novamente.", { status: 500 });
  }
}
