import { NextResponse, type NextRequest } from "next/server";
import { chaveDaRequisicao, SLUG_LOJA } from "@/lib/vitrine/chave";
import { lerVitrine } from "@/lib/vitrine/servico";

/**
 * Catálogo do site da loja (loja, categorias e produtos visíveis). Só responde
 * a quem apresenta a chave do site; sem ela, ou com a chave errada, a loja
 * "não existe" (404), sem dizer o porquê.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/vitrine/[slug]">) {
  const { slug } = await ctx.params;
  const chave = chaveDaRequisicao(req);
  if (!chave || !SLUG_LOJA.test(slug)) return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
  try {
    const vitrine = await lerVitrine(slug, chave);
    if (!vitrine) return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
    return NextResponse.json(vitrine, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ erro: "Catálogo indisponível agora." }, { status: 503 });
  }
}
