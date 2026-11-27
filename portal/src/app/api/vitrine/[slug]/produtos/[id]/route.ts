import { NextResponse, type NextRequest } from "next/server";
import { chaveDaRequisicao, SLUG_LOJA } from "@/lib/vitrine/chave";
import { lerProdutoVitrine } from "@/lib/vitrine/servico";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um produto do site com descrição, todas as fotos e as variações. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/vitrine/[slug]/produtos/[id]">) {
  const { slug, id } = await ctx.params;
  const chave = chaveDaRequisicao(req);
  if (!chave || !SLUG_LOJA.test(slug) || !UUID.test(id)) return NextResponse.json({ erro: "Produto não encontrado." }, { status: 404 });
  try {
    const produto = await lerProdutoVitrine(slug, chave, id);
    if (!produto) return NextResponse.json({ erro: "Produto não encontrado." }, { status: 404 });
    return NextResponse.json(produto, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ erro: "Produto indisponível agora." }, { status: 503 });
  }
}
