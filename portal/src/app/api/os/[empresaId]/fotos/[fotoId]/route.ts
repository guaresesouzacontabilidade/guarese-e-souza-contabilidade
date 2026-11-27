import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_NAVEGADOR = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Abre a foto de uma OS (só quem usa as OS da própria empresa): redireciona
 * para um link temporário (2 minutos) do armazenamento privado. HEIC é baixado.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; fotoId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, fotoId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(fotoId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("os.operar")) return new NextResponse("Acesso negado.", { status: 403 });
  const { data: foto } = await s.supabase.from("os_fotos").select("empresa_id, caminho, mime, confirmado_em").eq("id", fotoId).maybeSingle();
  if (!foto || foto.empresa_id !== empresaId || !foto.confirmado_em) return new NextResponse("Foto não encontrada.", { status: 404 });
  const ext = foto.caminho.split(".").pop() ?? "jpg";
  const { data: link, error } = await s.supabase.storage
    .from("os-fotos")
    .createSignedUrl(foto.caminho, 120, NO_NAVEGADOR.has(foto.mime) ? undefined : { download: `foto-os.${ext}` });
  if (error || !link) return new NextResponse("Arquivo indisponível no momento.", { status: 404 });
  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "private, max-age=60");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
