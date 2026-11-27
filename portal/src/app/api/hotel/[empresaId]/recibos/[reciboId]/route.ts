import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { listarRecibosExtras } from "@/lib/hotel/dados";
import { carregarIdentidadeHotel, gerarDocumentoHotel, paletaDe } from "@/lib/hotel/documento";
import { blocosReciboExtra } from "@/lib/hotel/pdf";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recibo em PDF dos serviços extras lançados para uma empresa, com a identidade do hotel. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; reciboId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, reciboId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(reciboId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  try {
    const { data: linha } = await s.supabase.from("hotel_extras_recibos").select("data").eq("id", reciboId).eq("empresa_id", empresaId).maybeSingle();
    if (!linha) return new NextResponse("Recibo não encontrado.", { status: 404 });
    const [recibos, identidade] = await Promise.all([listarRecibosExtras(s.supabase, empresaId, linha.data, linha.data), carregarIdentidadeHotel(s.supabase, empresaId)]);
    const r = recibos.find((x) => x.id === reciboId);
    if (!r) return new NextResponse("Recibo não encontrado.", { status: 404 });
    const arquivo = await gerarDocumentoHotel(
      identidade,
      {
        titulo: r.situacao === "cancelado" ? "Recibo de serviços extras (cancelado)" : "Recibo de serviços extras",
        subtitulo: `Recibo nº ${r.numero} — ${r.empresa}`,
        notaFinal: "Este recibo não substitui a nota fiscal de serviço (NFS-e), que, quando emitida, é enviada à parte.",
      },
      blocosReciboExtra(r, identidade.nome, paletaDe(identidade.modelo, identidade.cor)),
    );
    const nome = nomeArquivo(["recibo-servicos-extras", String(r.numero), r.empresa], "pdf");
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o recibo de serviços extras", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
