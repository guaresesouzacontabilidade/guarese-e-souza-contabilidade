import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { carregarRelatorioCaixa } from "@/lib/gestao/dados";
import { movimentoHotel } from "@/lib/hotel/dados";
import { carregarIdentidadeHotel, gerarDocumentoHotel, paletaDe } from "@/lib/hotel/documento";
import { blocosTurno } from "@/lib/hotel/pdf";
import { formatarData } from "@/lib/formatos";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OITO_DIAS = 8 * 24 * 3600 * 1000 - 60_000;

/** Relatório do turno da recepção em PDF: o caixa do turno e o que aconteceu no hotel no horário dele. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; sessaoId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, sessaoId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(sessaoId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  try {
    const rel = await carregarRelatorioCaixa(s.supabase, sessaoId);
    if (!rel || rel.sessao.empresa_id !== empresaId) return new NextResponse("Turno não encontrado.", { status: 404 });
    const ate = rel.sessao.fechado_em ?? new Date().toISOString();
    const de = new Date(Math.max(new Date(rel.sessao.aberto_em).getTime(), new Date(ate).getTime() - OITO_DIAS)).toISOString();
    const [movimentos, identidade] = await Promise.all([movimentoHotel(s.supabase, empresaId, de, ate), carregarIdentidadeHotel(s.supabase, empresaId)]);
    const arquivo = await gerarDocumentoHotel(
      identidade,
      {
        titulo: rel.sessao.status === "fechado" ? "Relatório do turno" : "Relatório do turno (em andamento)",
        subtitulo: `${rel.sessao.caixa_nome} — ${formatarData(rel.sessao.data)}`,
        notaFinal: "Documento interno da recepção: o dinheiro é o do caixa do turno; o movimento é tudo o que aconteceu no hotel no horário do turno.",
      },
      blocosTurno(rel, movimentos, paletaDe(identidade.modelo, identidade.cor)),
    );
    const nome = nomeArquivo(["turno", rel.sessao.data, rel.sessao.caixa_nome], "pdf");
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o relatório do turno", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
