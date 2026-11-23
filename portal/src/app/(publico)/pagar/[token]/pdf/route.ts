import { NextResponse } from "next/server";
import { montarCobrancaPdf } from "@/lib/honorarios/montar";
import { gerarPdfCobranca, nomeArquivoCobranca } from "@/lib/honorarios/pdf";
import { cobrancaPorToken } from "../carregar";

export const maxDuration = 60;

/** PDF da cobrança pelo link de pagamento (sem login). */
export async function GET(_req: Request, { params }: RouteContext<"/pagar/[token]/pdf">) {
  const { token } = await params;
  const r = await cobrancaPorToken(token);
  if (!r) return new NextResponse("Cobrança não encontrada.", { status: 404 });
  const dados = await montarCobrancaPdf(r.c, r.itens);
  return new NextResponse(new Uint8Array(await gerarPdfCobranca(dados)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivoCobranca(dados)}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
