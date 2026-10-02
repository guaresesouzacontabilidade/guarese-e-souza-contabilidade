import { NextResponse, type NextRequest } from "next/server";
import type { Content } from "pdfmake/interfaces";
import { sessaoApi } from "@/lib/auth/sessao";
import { formatarDataHora } from "@/lib/formatos";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { blocoDre, blocoFluxo, blocoIndicadores, blocoLimitacoes, blocoProjecao, blocoTexto, gerarPdf } from "@/lib/relatorios/pdf";
import { bufferPlanilha, novaPasta, planilhaDre, planilhaFluxo, planilhaIndicadores, planilhaProjecao } from "@/lib/relatorios/excel";
import { lerSnapshot, TIPOS_RELATORIO, type TipoRelatorio } from "@/lib/relatorios/snapshot";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** PDF ou Excel de um relatório preparado pelo escritório (a partir da "foto" guardada). */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/relatorios/[id]/arquivo">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Relatório inválido.", { status: 400 });
  const formato = req.nextUrl.searchParams.get("formato") === "xlsx" ? "xlsx" : "pdf";
  // As regras de acesso do banco só devolvem relatórios publicados a quem pode vê-los.
  const { data: rel } = await s.supabase
    .from("relatorios_publicados")
    .select("id, empresa_id, tipo, titulo, versao, situacao, status, dados, resumo_texto, comentarios_contador, limitacoes, publicado_em, atualizado_em")
    .eq("id", id)
    .maybeSingle();
  if (!rel) return new NextResponse("Relatório não encontrado.", { status: 404 });
  const dados = lerSnapshot(rel.dados);
  if (!dados) return new NextResponse("Relatório sem números guardados.", { status: 422 });

  const tipo = rel.tipo as TipoRelatorio;
  const completo = tipo === "pacote_mensal";
  const limitacoes = Array.isArray(rel.limitacoes) ? (rel.limitacoes as string[]) : [];
  const rascunho = rel.status === "rascunho";
  const resumo = (rel.resumo_texto ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const proximas = dados.projecao.proximas;
  const projecao = { janelas: dados.projecao.janelas, menorSaldo: dados.projecao.menorSaldo, vencidos: dados.projecao.vencidos, pontos: [] };

  try {
    let arquivo: Buffer;
    if (formato === "pdf") {
      const blocos: Content[] = [...blocoTexto("Resumo", rel.resumo_texto), ...blocoTexto("Comentários do contador", rel.comentarios_contador)];
      if (completo || tipo === "resumo_executivo") blocos.push(...blocoIndicadores(dados.indicadores, []));
      if (completo || tipo === "dre") blocos.push(...blocoDre(dados.dre, dados.periodo.rotulo));
      if (completo || tipo === "fluxo_caixa") blocos.push(...blocoFluxo(dados.fluxo), ...blocoProjecao(projecao, dados.projecao.saldoHoje, proximas));
      blocos.push(...blocoLimitacoes(limitacoes));
      const cab = await montarCabecalho(s.supabase, rel.empresa_id, {
        titulo: rel.titulo,
        subtitulo: `${TIPOS_RELATORIO[tipo]?.rotulo ?? tipo} · ${dados.periodo.rotulo}${rascunho ? "" : ` · versão ${rel.versao}`}`,
        situacao: rascunho ? "rascunho" : rel.situacao === "revisado" ? "revisado" : "preliminar",
        geradoEm: rel.publicado_em ?? rel.atualizado_em,
      });
      arquivo = await gerarPdf(cab, blocos);
    } else {
      const wb = novaPasta();
      const info = {
        titulo: rel.titulo,
        empresa: dados.periodo.rotulo,
        periodo: `${TIPOS_RELATORIO[tipo]?.rotulo ?? tipo}${rascunho ? " (rascunho)" : ` · versão ${rel.versao}`}`,
        situacao: rascunho ? "Rascunho" : rel.situacao === "revisado" ? "Revisado pelo escritório" : "Preliminar",
        geradoEm: formatarDataHora(rel.publicado_em ?? rel.atualizado_em),
      };
      planilhaIndicadores(wb, info, completo || tipo === "resumo_executivo" ? dados.indicadores : [], [...resumo, ...(rel.comentarios_contador ? ["", "Comentários do contador:", rel.comentarios_contador] : []), ...limitacoes.map((l) => `Limitação: ${l}`)]);
      if (completo || tipo === "dre") planilhaDre(wb, info, dados.dre);
      if (completo || tipo === "fluxo_caixa") {
        planilhaFluxo(wb, info, dados.fluxo);
        planilhaProjecao(wb, info, projecao, dados.projecao.saldoHoje, proximas);
      }
      arquivo = await bufferPlanilha(wb);
    }
    if (!rascunho) await s.supabase.rpc("registrar_acesso_relatorio", { p_id: rel.id, p_tipo: formato === "pdf" ? "download_pdf" : "download_xlsx" });
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nomeArquivo([rel.titulo, rascunho ? "rascunho" : `v${rel.versao}`], formato)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar arquivo do relatório", e);
    return new NextResponse("Não foi possível gerar o arquivo. Tente novamente.", { status: 500 });
  }
}
