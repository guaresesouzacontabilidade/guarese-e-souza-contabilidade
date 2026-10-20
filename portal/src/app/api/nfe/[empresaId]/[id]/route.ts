import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { dadosRequisicao } from "@/lib/requisicao";
import { gerarDanfe } from "@/lib/nfe-emissao/danfe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DANFE (PDF), XML da NF-e (nfeProc) ou XML de um evento (cancelamento ou
 * carta de correção) de uma nota emitida pelo portal. O XML vem do banco com
 * as regras de acesso do usuário (só quem emite ou configura a emissão da
 * empresa); o PDF é gerado na hora a partir dele.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/nfe/[empresaId]/[id]">) {
  const { empresaId, id } = await ctx.params;
  if (!UUID.test(empresaId) || !UUID.test(id)) return new NextResponse("Nota inválida.", { status: 400 });
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL(`/login?proximo=${encodeURIComponent(`/e/${empresaId}/notas-produto/${id}`)}`, req.url));
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !(acesso.permissoes.has("nfe.emitir") || acesso.permissoes.has("nfe.configurar"))) return new NextResponse("Acesso negado.", { status: 403 });

  const { data: n } = await s.supabase
    .from("nfe_emissoes")
    .select("id, xml_autorizado, chave, numero, situacao")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!n?.xml_autorizado || !n.chave) return new NextResponse("Nota ainda não autorizada.", { status: 404 });
  const pedido = req.nextUrl.searchParams.get("formato");
  const formato = pedido === "xml" || pedido === "evento" ? pedido : "pdf";
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "exportacao",
    p_entidade: "nfe_emissoes",
    p_entidade_id: n.id,
    p_empresa_id: empresaId,
    p_detalhes: { formato },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  const cabecalhoXml = (nome: string) => ({
    "Content-Type": "application/xml; charset=utf-8",
    "Content-Disposition": `attachment; filename="${nome}.xml"`,
    "Cache-Control": "no-store",
  });

  if (formato === "evento") {
    const eventoId = req.nextUrl.searchParams.get("evento") ?? "";
    if (!UUID.test(eventoId)) return new NextResponse("Evento inválido.", { status: 400 });
    const { data: ev } = await s.supabase.from("nfe_eventos").select("tipo, sequencia, xml").eq("id", eventoId).eq("emissao_id", id).maybeSingle();
    if (!ev?.xml) return new NextResponse("Evento sem XML registrado.", { status: 404 });
    const nome = `${ev.tipo === "cancelamento" ? "Cancelamento" : `CCe-${ev.sequencia}`}-NFe-${n.numero}-${n.chave}`;
    return new NextResponse(ev.xml, { headers: cabecalhoXml(nome) });
  }
  const nome = `NFe-${n.numero}-${n.chave}`;
  if (formato === "xml") return new NextResponse(n.xml_autorizado, { headers: cabecalhoXml(nome) });
  const pdf = await gerarDanfe(n.xml_autorizado, { cancelada: n.situacao === "cancelada" });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nome}.pdf"`, "Cache-Control": "no-store" },
  });
}
