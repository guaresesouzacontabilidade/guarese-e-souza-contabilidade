import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { carregarDeclaracaoPdf } from "@/lib/declaracoes/carregar";
import { gerarPdfDeclaracao } from "@/lib/declaracoes/pdf";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";
import { dadosRequisicao } from "@/lib/requisicao";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** PDF da declaração de faturamento (para assinar). O acesso segue as regras do banco. */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/declaracoes/[id]/pdf">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Declaração inválida.", { status: 400 });
  const r = await carregarDeclaracaoPdf(s.supabase, id);
  if (!r) return new NextResponse("Declaração não encontrada.", { status: 404 });
  const arquivo = await gerarPdfDeclaracao(r.pdf);
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "download",
    p_entidade: "declaracao_faturamento",
    p_entidade_id: id,
    p_empresa_id: r.empresaId,
    p_detalhes: { situacao: r.pdf.situacao },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  const nome = nomeArquivo(["declaracao-faturamento", r.nomeEmpresa, r.pdf.periodo.inicio.slice(0, 7), "a", r.pdf.periodo.fim.slice(0, 7)], "pdf");
  const inline = req.nextUrl.searchParams.get("ver") === "1";
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
