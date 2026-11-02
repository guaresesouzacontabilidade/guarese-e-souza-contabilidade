import { NextResponse, type NextRequest } from "next/server";
import { ehEquipe, sessaoApi } from "@/lib/auth/sessao";
import { gerarPdfEstudo, type EstudoPdf } from "@/lib/estudos/pdf";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDF de um estudo tributário para o cliente: só a equipe e só depois de aprovado. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  if (!ehEquipe(s.perfil)) return new NextResponse("Acesso negado.", { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Estudo inválido.", { status: 400 });
  const recado = (req.nextUrl.searchParams.get("recado") ?? "").trim().slice(0, 2000) || null;

  // Lido com as regras de acesso de quem pediu: só aparece se a pessoa atende a empresa
  const { data: estudo } = await s.supabase
    .from("estudo_oportunidades")
    .select("id, empresa_id, tipo, estado, titulo, resumo, economia_anual, valor_unico, detalhes, situacao, revisado_em, atualizado_em")
    .eq("id", id)
    .maybeSingle();
  if (!estudo) return new NextResponse("Estudo não encontrado.", { status: 404 });
  if (estudo.situacao !== "aprovada" && estudo.situacao !== "apresentada") {
    return new NextResponse("Aprove o estudo antes de gerar o PDF para o cliente.", { status: 409 });
  }
  const { data: empresa } = await s.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("id", estudo.empresa_id).maybeSingle();
  if (!empresa) return new NextResponse("Estudo não encontrado.", { status: 404 });
  try {
    const r = await gerarPdfEstudo(s.supabase, empresa, estudo as unknown as EstudoPdf, recado);
    return new NextResponse(new Uint8Array(r.arquivo), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${r.nome}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao gerar o PDF do estudo tributário", e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
