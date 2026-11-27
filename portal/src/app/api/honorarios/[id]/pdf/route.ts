import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { itensDaCobranca, montarCobrancaPdf } from "@/lib/honorarios/montar";
import { gerarPdfCobranca, nomeArquivoCobranca } from "@/lib/honorarios/pdf";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * PDF da cobrança: o escritório autorizado vê todas; o cliente, só as da
 * própria empresa já enviadas (a regra está no banco).
 */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/honorarios/[id]/pdf">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Cobrança inválida.", { status: 400 });
  const { data: c } = await s.supabase.from("honorarios_cobrancas").select("*").eq("id", id).maybeSingle();
  if (!c) return new NextResponse("Cobrança não encontrada.", { status: 404 });
  const dados = await montarCobrancaPdf(c, await itensDaCobranca(s.supabase, id));
  const pdf = await gerarPdfCobranca(dados);
  const inline = req.nextUrl.searchParams.get("ver") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nomeArquivoCobranca(dados)}"`,
      "Cache-Control": "no-store",
    },
  });
}
