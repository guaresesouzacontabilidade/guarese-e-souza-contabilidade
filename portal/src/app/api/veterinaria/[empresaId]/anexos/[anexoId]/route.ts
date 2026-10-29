import { NextResponse, type NextRequest } from "next/server";
import { sessaoClinica } from "@/lib/veterinaria/api";

/**
 * Abre um exame ou laudo anexado ao prontuário: redireciona para um link
 * temporário (2 minutos) do armazenamento privado, lido com as regras de
 * acesso de quem pediu.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; anexoId: string }> }) {
  const { empresaId, anexoId } = await params;
  const s = await sessaoClinica(empresaId, anexoId);
  if (s instanceof NextResponse) return s;
  const { data: anexo } = await s.supabase.from("vet_anexos").select("empresa_id, caminho, confirmado_em").eq("id", anexoId).maybeSingle();
  if (!anexo || anexo.empresa_id !== empresaId || !anexo.confirmado_em) return new NextResponse("Arquivo não encontrado.", { status: 404 });
  const { data: link, error } = await s.supabase.storage.from("vet-anexos").createSignedUrl(anexo.caminho, 120);
  if (error || !link) return new NextResponse("Arquivo indisponível no momento.", { status: 404 });
  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
