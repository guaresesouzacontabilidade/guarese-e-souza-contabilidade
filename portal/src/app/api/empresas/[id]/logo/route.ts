import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { tipoImagem } from "@/lib/imagens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Logo da empresa (armazenamento privado) para as páginas de impressão e o
 * cabeçalho dos relatórios impressos. O banco só entrega a logo a quem tem
 * acesso à empresa.
 */
export async function GET(_req: NextRequest, { params }: RouteContext<"/api/empresas/[id]/logo">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Empresa inválida.", { status: 400 });
  const { data: empresa } = await s.supabase.from("empresas").select("logo_path").eq("id", id).maybeSingle();
  if (!empresa?.logo_path) return new NextResponse("Sem logo.", { status: 404 });
  const { data } = await s.supabase.storage.from("empresas-logos").download(empresa.logo_path);
  if (!data) return new NextResponse("Sem logo.", { status: 404 });
  const bytes = new Uint8Array(await data.arrayBuffer());
  const tipo = tipoImagem(bytes);
  if (!tipo) return new NextResponse("Sem logo.", { status: 404 });
  return new NextResponse(bytes, {
    headers: { "Content-Type": tipo, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
