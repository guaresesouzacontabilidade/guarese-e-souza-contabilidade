import { NextResponse, type NextRequest } from "next/server";
import { ehEquipe, sessaoApi } from "@/lib/auth/sessao";
import { arquivoAssinado } from "@/lib/recibos/arquivo";
import { carregarRecibo } from "@/lib/recibos/carregar";
import { gerarPdfRecibo, nomeArquivoRecibo } from "@/lib/recibos/pdf";
import { dadosRequisicao } from "@/lib/requisicao";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** PDF do recibo de honorários (só a equipe do escritório; a regra também está no banco). */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/recibos/[id]/pdf">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  if (!ehEquipe(s.perfil)) return new NextResponse("Recibo não encontrado.", { status: 404 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Recibo inválido.", { status: 400 });
  const r = await carregarRecibo(s.supabase, id);
  if (!r) return new NextResponse("Recibo não encontrado.", { status: 404 });
  // O arquivo assinado guardado (o mesmo que foi assinado); cancelado ou sem assinatura, gera na hora
  const arquivo = (await arquivoAssinado(r.linha)) ?? (await gerarPdfRecibo(r.pdf));
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    // "download" não está na lista de eventos aceitos pelo banco; a baixa do PDF entra como exportação
    p_acao: "exportacao",
    p_entidade: "recibo_honorarios",
    p_entidade_id: id,
    p_empresa_id: r.linha.empresa_id ?? undefined,
    p_detalhes: { numero: r.linha.numero, ano: r.linha.ano, situacao: r.linha.situacao, assinado: Boolean(r.linha.arquivo_path) },
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  const inline = req.nextUrl.searchParams.get("ver") === "1";
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nomeArquivoRecibo(r.pdf)}"`,
      "Cache-Control": "no-store",
    },
  });
}
