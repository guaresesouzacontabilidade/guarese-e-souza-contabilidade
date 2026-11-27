import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { hojeISO } from "@/lib/competencia";
import { nomeMes } from "@/lib/formatos";
import { blocosRelatorio } from "@/lib/hotel/pdf";
import { carregarRelatorio, proximoMes } from "@/lib/hotel/relatorio";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { gerarPdf } from "@/lib/relatorios/pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Relatório mensal do hotel em PDF (ocupação, diária média, RevPAR, origem e recebimentos). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId } = await params;
  if (!UUID.test(empresaId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.gerenciar")) return new NextResponse("Acesso negado.", { status: 403 });
  const hoje = hojeISO();
  const pedido = req.nextUrl.searchParams.get("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(pedido) && pedido <= hoje.slice(0, 7) ? pedido : hoje.slice(0, 7);
  try {
    const rel = await carregarRelatorio(s.supabase, empresaId, `${mes}-01`, proximoMes(mes));
    const nome = `${nomeMes(Number(mes.slice(5, 7)))} de ${mes.slice(0, 4)}`;
    const cab = await montarCabecalho(s.supabase, empresaId, {
      titulo: "Relatório do hotel",
      subtitulo: `${nome.charAt(0).toUpperCase()}${nome.slice(1)}${mes === hoje.slice(0, 7) ? " — mês em andamento" : ""}`,
      situacao: "preliminar",
      observacao:
        "Ocupação = noites ocupadas ÷ (quartos em uso × noites do mês). Diária média = receita de diárias ÷ diárias cobradas. RevPAR = receita de diárias ÷ quartos-noite disponíveis. As diárias entram na receita no check-out, na data de cada noite.",
    });
    const arquivo = await gerarPdf(cab, blocosRelatorio(rel, mes));
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomeArquivo(["relatorio-hotel", acesso.nome_fantasia || acesso.razao_social, mes], "pdf")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o relatório do hotel", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
