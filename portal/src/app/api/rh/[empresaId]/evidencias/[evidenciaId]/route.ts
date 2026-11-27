import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { exibeNoNavegador } from "@/lib/hotel/comprovante-arquivo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Abre a evidência de uma tarefa (o gestor ou quem é responsável por ela; o
 * banco confere): redireciona para um link temporário (2 minutos) do
 * armazenamento privado. HEIC é baixado.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; evidenciaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, evidenciaId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(evidenciaId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !(acesso.permissoes.has("rh.gerenciar") || acesso.permissoes.has("rh.tarefas"))) return new NextResponse("Acesso negado.", { status: 403 });
  // A política do banco só devolve a evidência a quem pode ver a tarefa
  const { data: ev } = await s.supabase.from("rh_tarefa_evidencias").select("empresa_id, caminho, mime, confirmado_em").eq("id", evidenciaId).maybeSingle();
  if (!ev || ev.empresa_id !== empresaId || !ev.confirmado_em) return new NextResponse("Arquivo não encontrado.", { status: 404 });
  const ext = ev.caminho.split(".").pop() ?? "jpg";
  const { data: link, error } = await s.supabase.storage
    .from("rh-evidencias")
    .createSignedUrl(ev.caminho, 120, exibeNoNavegador(ev.mime) ? undefined : { download: `evidencia.${ext}` });
  if (error || !link) return new NextResponse("Arquivo indisponível no momento.", { status: 404 });
  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "private, max-age=60");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
