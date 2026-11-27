import { NextResponse } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Download do arquivo da EFD ICMS/IPI gerado (texto ISO-8859-1). Só a equipe
 * que gerencia os cálculos da empresa; o armazenamento também confere (RLS).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ empresaId: string; geracaoId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, geracaoId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(geracaoId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso?.permissoes.has("calculos.gerenciar")) return new NextResponse("Acesso negado.", { status: 403 });
  const { data: g } = await s.supabase
    .from("efd_geracoes")
    .select("nome_arquivo, storage_path, sha256")
    .eq("id", geracaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!g) return new NextResponse("Arquivo não encontrado.", { status: 404 });
  const { data: arquivo, error } = await s.supabase.storage.from("efd").download(g.storage_path);
  if (error || !arquivo) return new NextResponse("Não foi possível baixar o arquivo.", { status: 404 });
  const nome = g.nome_arquivo.replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(await arquivo.arrayBuffer()), {
    headers: {
      "Content-Type": "text/plain; charset=iso-8859-1",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
