import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { dadosRequisicao } from "@/lib/requisicao";
import { mensagemErro } from "@/lib/acoes";
import { criarClienteAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f-]{36}$/i;
const texto = (corpo: string, status: number) => new NextResponse(corpo, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * Baixa uma parte de um lote de XML: o banco confere a permissão e registra o
 * acesso a cada documento do lote; depois o servidor gera um link temporário
 * (1 minuto) do armazenamento privado. O arquivo do lote não fica acessível
 * diretamente a nenhum usuário.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/lotes-xml/[id]/[parte]">) {
  const { id, parte } = await ctx.params;
  if (!UUID.test(id) || !/^\d{1,4}$/.test(parte)) return texto("Lote inválido.", 404);
  // Somente a partir do próprio portal
  if (req.headers.get("sec-fetch-site") === "cross-site") return texto("Abra o lote pelo portal.", 403);
  const s = await sessaoApi();
  if (!s) return NextResponse.redirect(new URL(`/login?proximo=${encodeURIComponent(req.nextUrl.pathname)}`, req.url));

  const { ip, userAgent } = await dadosRequisicao();
  const { data, error } = await s.supabase.rpc("baixar_lote_xml", {
    p_lote_id: id,
    p_parte: Number(parte),
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
  });
  if (error || !data) return texto(mensagemErro(error), 403);
  const info = data as unknown as { caminho: string; nome: string };

  // O link é gerado com a chave do servidor porque o arquivo do lote não tem
  // leitura direta para usuários: só sai depois da conferência acima.
  const { data: link, error: e2 } = await criarClienteAdmin().storage.from("documentos").createSignedUrl(info.caminho, 60, { download: info.nome });
  if (e2 || !link) return texto("Arquivo indisponível no momento. Gere o lote de novo.", 404);
  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
