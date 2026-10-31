import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import type { ResumoCaixa } from "@/lib/gestao/dados";
import { movimentoHotel } from "@/lib/hotel/dados";
import { carregarIdentidadeHotel, gerarDocumentoHotel, paletaDe } from "@/lib/hotel/documento";
import { blocosDiaHotel, type TurnoDoDia } from "@/lib/hotel/pdf";
import { formatarData } from "@/lib/formatos";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Horário do escritório (Tocantins), sem horário de verão. */
const FUSO = "-03:00";

/** Relatório do dia do hotel em PDF (?data=AAAA-MM-DD): os turnos do dia e tudo o que aconteceu nas reservas. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId } = await params;
  const dia = req.nextUrl.searchParams.get("data") ?? "";
  if (!UUID.test(empresaId) || !DIA.test(dia)) return new NextResponse("Informe o dia.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  try {
    const [{ data: sessoes }, movimentos, identidade] = await Promise.all([
      s.supabase
        .from("caixa_sessoes")
        .select("id, caixa_nome, status, aberto_em, fechado_em, valor_contado, diferenca, resumo, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
        .eq("empresa_id", empresaId)
        .eq("data", dia)
        .order("aberto_em"),
      movimentoHotel(s.supabase, empresaId, `${dia}T00:00:00${FUSO}`, `${dia}T23:59:59.999${FUSO}`),
      carregarIdentidadeHotel(s.supabase, empresaId),
    ]);
    const turnos: TurnoDoDia[] = await Promise.all(
      (sessoes ?? []).map(async (t) => {
        const resumo =
          t.status === "aberto" ? ((await s.supabase.rpc("gestao_caixa_resumo", { p_sessao_id: t.id })).data as unknown as ResumoCaixa) : (t.resumo as unknown as ResumoCaixa);
        return {
          caixa_nome: t.caixa_nome,
          operador: (t.operador as { nome?: string } | null)?.nome ?? null,
          aberto_em: t.aberto_em,
          fechado_em: t.fechado_em,
          resumo: resumo ?? ({} as ResumoCaixa),
          valor_contado: t.valor_contado == null ? null : String(t.valor_contado),
          diferenca: t.diferenca == null ? null : String(t.diferenca),
        };
      }),
    );
    const arquivo = await gerarDocumentoHotel(
      identidade,
      { titulo: "Relatório do dia do hotel", subtitulo: formatarData(dia), notaFinal: "Documento interno: os turnos (caixas) abertos no dia e o movimento das reservas, com quem fez cada coisa." },
      blocosDiaHotel(turnos, movimentos, paletaDe(identidade.modelo, identidade.cor)),
    );
    const nome = nomeArquivo(["relatorio-dia-hotel", dia], "pdf");
    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o relatório do dia do hotel", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
