import { NextResponse } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";
import { dadosRequisicao } from "@/lib/requisicao";

const UUID = /^[0-9a-f-]{36}$/i;

/** Versão assinada da declaração (PDF enviado de volta ao portal). */
export async function GET(_req: Request, { params }: RouteContext<"/api/declaracoes/[id]/assinada">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Declaração inválida.", { status: 400 });
  const { data: d } = await s.supabase
    .from("declaracoes_faturamento")
    .select("empresa_id, assinada_path, periodo_inicio, periodo_fim, empresa:empresas(razao_social, nome_fantasia)")
    .eq("id", id)
    .maybeSingle();
  if (!d?.assinada_path) return new NextResponse("Declaração assinada não encontrada.", { status: 404 });
  const { data: arquivo, error } = await s.supabase.storage.from("declaracoes").download(d.assinada_path);
  if (error || !arquivo) return new NextResponse("Arquivo indisponível.", { status: 404 });
  const { ip, userAgent } = await dadosRequisicao();
  await s.supabase.rpc("registrar_evento", {
    p_acao: "download",
    p_entidade: "declaracao_faturamento_assinada",
    p_entidade_id: id,
    p_empresa_id: d.empresa_id,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  const empresa = d.empresa as unknown as { razao_social: string; nome_fantasia: string | null } | null;
  const nome = nomeArquivo(["declaracao-faturamento-assinada", empresa?.nome_fantasia ?? empresa?.razao_social, d.periodo_inicio.slice(0, 7), "a", d.periodo_fim.slice(0, 7)], "pdf");
  return new NextResponse(new Uint8Array(await arquivo.arrayBuffer()), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "no-store" },
  });
}
