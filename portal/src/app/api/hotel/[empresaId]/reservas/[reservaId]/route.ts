import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { carregarReserva } from "@/lib/hotel/dados";
import { blocosConta, blocosFicha } from "@/lib/hotel/pdf";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { gerarPdf } from "@/lib/relatorios/pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDFs da reserva: ficha de registro do hóspede (?doc=ficha) e confirmação/extrato/recibo da conta (?doc=conta). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string; reservaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, reservaId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(reservaId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  const doc = req.nextUrl.searchParams.get("doc") === "ficha" ? "ficha" : "conta";
  try {
    const [c, { data: cfg }] = await Promise.all([
      carregarReserva(s.supabase, empresaId, reservaId),
      s.supabase.from("hotel_config").select("hora_checkin, hora_checkout, cafe_incluso, politica").eq("empresa_id", empresaId).maybeSingle(),
    ]);
    if (!c) return new NextResponse("Reserva não encontrada.", { status: 404 });
    const r = c.reserva;
    const aguardando = r.status === "pre_reserva" || r.status === "confirmada";
    const titulo = doc === "ficha" ? "Ficha de registro do hóspede" : aguardando ? "Confirmação de reserva" : r.status === "encerrada" ? "Recibo da conta do hóspede" : "Extrato da conta do hóspede";
    const cab = await montarCabecalho(s.supabase, empresaId, {
      titulo,
      subtitulo: `Reserva nº ${r.numero} — quarto ${r.quarto?.numero ?? ""} — ${r.hospede?.nome ?? ""}`,
      situacao: "documento",
      notaFinal: doc === "conta" && r.status === "encerrada" ? "Recibo dos valores pagos pela hospedagem. A nota fiscal de serviço (NFS-e), quando emitida, é enviada à parte." : null,
    });
    const arquivo = await gerarPdf(cab, doc === "ficha" ? blocosFicha(c) : blocosConta(c, cfg ?? null));
    const nome = nomeArquivo([doc === "ficha" ? "ficha-hospede" : aguardando ? "confirmacao-reserva" : "conta-hospede", String(r.numero), r.hospede?.nome], "pdf");
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o PDF da reserva", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
