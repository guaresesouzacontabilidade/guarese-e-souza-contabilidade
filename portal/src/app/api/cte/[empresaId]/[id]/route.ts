import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { dadosRequisicao } from "@/lib/requisicao";
import { gerarDacte } from "@/lib/cte-emissao/dacte";
import { logoDoCliente } from "@/lib/marca/logos-relatorio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DACTE (PDF), XML do CT-e (cteProc) ou XML de um evento (cancelamento ou
 * carta de correção) de um CT-e emitido pelo portal. O XML vem do banco com as
 * regras de acesso do usuário (só quem emite ou configura o CT-e da empresa);
 * o PDF é gerado na hora a partir dele.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/cte/[empresaId]/[id]">) {
  const { empresaId, id } = await ctx.params;
  if (!UUID.test(empresaId) || !UUID.test(id)) return new NextResponse("CT-e inválido.", { status: 400 });
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL(`/login?proximo=${encodeURIComponent(`/e/${empresaId}/cte/${id}`)}`, req.url));
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !(acesso.permissoes.has("cte.emitir") || acesso.permissoes.has("cte.configurar"))) return new NextResponse("Acesso negado.", { status: 403 });

  const { data: c } = await s.supabase.from("cte_emissoes").select("id, xml_autorizado, chave, numero, situacao").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
  if (!c?.xml_autorizado || !c.chave) return new NextResponse("CT-e ainda não autorizado.", { status: 404 });
  const pedido = req.nextUrl.searchParams.get("formato");
  const formato = pedido === "xml" || pedido === "evento" ? pedido : "pdf";
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "exportacao",
    p_entidade: "cte_emissoes",
    p_entidade_id: c.id,
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
    const { data: ev } = await s.supabase.from("cte_eventos").select("tipo, sequencia, xml").eq("id", eventoId).eq("emissao_id", id).maybeSingle();
    if (!ev?.xml) return new NextResponse("Evento sem XML registrado.", { status: 404 });
    const nome = `${ev.tipo === "cancelamento" ? "Cancelamento" : `CCe-${ev.sequencia}`}-CTe-${c.numero}-${c.chave}`;
    return new NextResponse(ev.xml, { headers: cabecalhoXml(nome) });
  }
  const nome = `CTe-${c.numero}-${c.chave}`;
  if (formato === "xml") return new NextResponse(c.xml_autorizado, { headers: cabecalhoXml(nome) });
  // A logo do DACTE é a da transportadora (a empresa), quando cadastrada
  const logo = await logoDoCliente(s.supabase, acesso.logo_path);
  const pdf = await gerarDacte(c.xml_autorizado, { cancelado: c.situacao === "cancelada", logo: logo?.dados ?? null });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nome}.pdf"`, "Cache-Control": "no-store" },
  });
}
