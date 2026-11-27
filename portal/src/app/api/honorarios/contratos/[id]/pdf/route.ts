import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { baixarArquivoContrato, nomeArquivoContrato } from "@/lib/honorarios/contratos";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * PDF do contrato: a via enviada para assinatura ou a via final (com o
 * registro das assinaturas). Quem pode ver a linha (banco) baixa o arquivo.
 */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/honorarios/contratos/[id]/pdf">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Documento inválido.", { status: 400 });
  const { data: c } = await s.supabase.from("honorarios_contratos").select("*").eq("id", id).maybeSingle();
  if (!c) return new NextResponse("Documento não encontrado.", { status: 404 });
  const final = req.nextUrl.searchParams.get("via") === "final" && Boolean(c.final_path);
  const caminho = final ? c.final_path : c.arquivo_path;
  const pdf = caminho ? await baixarArquivoContrato(caminho) : null;
  if (!pdf) return new NextResponse("Arquivo não encontrado.", { status: 404 });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${req.nextUrl.searchParams.get("ver") === "1" ? "inline" : "attachment"}; filename="${nomeArquivoContrato(c, final)}"`,
      "Cache-Control": "no-store",
    },
  });
}
