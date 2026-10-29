import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { gerarRelatorioCorrecoes } from "@/lib/auditor-fiscal/relatorio";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Relatório de correções do auditor fiscal (PDF ou planilha), só para a equipe. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId } = await params;
  const sp = req.nextUrl.searchParams;
  const ids = [...new Set((sp.get("ids") ?? "").split(",").filter((x) => UUID.test(x)))];
  const formato = sp.get("formato") === "xlsx" ? "xlsx" : "pdf";
  const recado = (sp.get("recado") ?? "").trim().slice(0, 2000) || null;
  if (!UUID.test(empresaId) || !ids.length || ids.length > 200) return new NextResponse("Escolha de 1 a 200 achados.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || !acesso.permissoes.has("auditor.gerenciar")) return new NextResponse("Acesso negado.", { status: 403 });
  try {
    const r = await gerarRelatorioCorrecoes(s.supabase, { id: empresaId, razao_social: acesso.razao_social, nome_fantasia: acesso.nome_fantasia, logo_path: acesso.logo_path }, ids, recado, formato);
    return new NextResponse(new Uint8Array(r.arquivo), {
      headers: {
        "Content-Type": r.tipo,
        "Content-Disposition": `attachment; filename="${r.nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o relatório de correções", e);
    return new NextResponse(e instanceof Error && e.message.startsWith("Nenhum achado") ? e.message : "Não foi possível gerar o relatório. Tente novamente.", { status: 500 });
  }
}
