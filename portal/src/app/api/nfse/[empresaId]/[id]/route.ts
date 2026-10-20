import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { dadosRequisicao } from "@/lib/requisicao";
import { gerarDanfse } from "@/lib/nfse-emissao/danfse";
import { lerNfse, no, val } from "@/lib/nfse-emissao/sefin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DANFSe (PDF) ou XML de uma NFS-e emitida pelo portal. O XML vem do banco com
 * as regras de acesso do usuário (só quem emite ou configura a emissão da
 * empresa); o PDF é gerado na hora a partir dele (NT 008).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/nfse/[empresaId]/[id]">) {
  const { empresaId, id } = await ctx.params;
  if (!UUID.test(empresaId) || !UUID.test(id)) return new NextResponse("Nota inválida.", { status: 400 });
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL(`/login?proximo=${encodeURIComponent(`/e/${empresaId}/notas-servico/${id}`)}`, req.url));
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !(acesso.permissoes.has("nfse.emitir") || acesso.permissoes.has("nfse.configurar"))) return new NextResponse("Acesso negado.", { status: 403 });

  const { data: n } = await s.supabase
    .from("nfse_emissoes")
    .select("id, xml_nfse, chave_acesso, numero_nfse, situacao, tomador_endereco")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!n?.xml_nfse || !n.chave_acesso) return new NextResponse("Nota ainda não emitida.", { status: 404 });
  const formato = req.nextUrl.searchParams.get("formato") === "xml" ? "xml" : "pdf";
  const nome = `NFSe-${n.numero_nfse ?? ""}-${n.chave_acesso}`;

  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "exportacao",
    p_entidade: "nfse_emissoes",
    p_entidade_id: n.id,
    p_empresa_id: empresaId,
    p_detalhes: { formato },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });

  if (formato === "xml") {
    return new NextResponse(n.xml_nfse, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}.xml"`, "Cache-Control": "no-store" },
    });
  }
  // Nomes dos municípios citados na nota (tabela do IBGE)
  const lida = lerNfse(n.xml_nfse);
  const codigos = [val(no(no(lida.dps, "toma"), "end"), "endNac", "cMun"), val(no(no(lida.dps, "prest"), "end"), "endNac", "cMun")].filter(
    (c): c is string => Boolean(c && /^[0-9]{7}$/.test(c)),
  );
  const { data: municipios } = codigos.length ? await s.supabase.from("municipios").select("ibge, nome, uf").in("ibge", codigos) : { data: [] };
  const pdf = await gerarDanfse(n.xml_nfse, {
    cancelada: n.situacao === "cancelada",
    municipios: Object.fromEntries((municipios ?? []).map((m) => [m.ibge, `${m.nome} / ${m.uf}`])),
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nome}.pdf"`, "Cache-Control": "no-store" },
  });
}
