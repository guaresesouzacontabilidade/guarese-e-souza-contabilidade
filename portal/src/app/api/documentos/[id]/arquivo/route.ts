import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { dadosRequisicao } from "@/lib/requisicao";
import { mensagemErro } from "@/lib/acoes";
import { MIME_VISUALIZACAO_SEGURA, mimeDe } from "@/lib/arquivos/tipos";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Abre ou baixa um documento: registra o acesso (quem, quando, qual versão) e
 * redireciona para um link temporário (2 minutos) do armazenamento privado.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/documentos/[id]/arquivo">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new NextResponse("Documento inválido.", { status: 404 });
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL(`/login?proximo=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`, req.url));

  const ver = req.nextUrl.searchParams.get("modo") === "ver";
  const versaoTexto = req.nextUrl.searchParams.get("versao");
  const versao = versaoTexto && /^\d{1,4}$/.test(versaoTexto) ? Number(versaoTexto) : undefined;
  const { ip, userAgent } = await dadosRequisicao();

  const { data, error } = await s.supabase.rpc("registrar_acesso_documento", {
    p_documento_id: id,
    p_tipo: ver ? "visualizacao" : "download",
    p_versao: versao,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  if (error || !data) return new NextResponse(mensagemErro(error), { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const info = data as unknown as { storage_path: string; nome: string; mime: string | null };

  // Só PDF e imagens comuns são exibidos no navegador; os demais são sempre baixados.
  const exibir = ver && MIME_VISUALIZACAO_SEGURA.has(info.mime ?? "") && MIME_VISUALIZACAO_SEGURA.has(mimeDe(info.nome));
  const { data: link, error: e2 } = await s.supabase.storage
    .from("documentos")
    .createSignedUrl(info.storage_path, 120, exibir ? undefined : { download: info.nome });
  if (e2 || !link) return new NextResponse("Arquivo indisponível no momento.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
