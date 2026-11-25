import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Assinatura de quem retirou a OS (só quem usa as OS da própria empresa), por link temporário. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; osId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, osId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(osId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("os.operar")) return new NextResponse("Acesso negado.", { status: 403 });
  const { data: o } = await s.supabase.from("os_ordens").select("empresa_id, assinatura_caminho").eq("id", osId).maybeSingle();
  if (!o || o.empresa_id !== empresaId || !o.assinatura_caminho) return new NextResponse("Assinatura não encontrada.", { status: 404 });
  const { data: link, error } = await s.supabase.storage.from("os-fotos").createSignedUrl(o.assinatura_caminho, 120);
  if (error || !link) return new NextResponse("Arquivo indisponível no momento.", { status: 404 });
  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "private, max-age=60");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
