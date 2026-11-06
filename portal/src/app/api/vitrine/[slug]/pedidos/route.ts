import { NextResponse, type NextRequest } from "next/server";
import { criarLimitador } from "@/lib/site/contato";
import { chaveDaRequisicao, SLUG_LOJA } from "@/lib/vitrine/chave";
import { registrarPedidoSite } from "@/lib/vitrine/servico";

/** Até 10 pedidos a cada 10 minutos por cliente (endereço de internet repassado pelo site) e 600 por hora por loja. */
const porCliente = criarLimitador(10, 10 * 60_000);
const porLoja = criarLimitador(600, 60 * 60_000);

/**
 * Pedido feito no site da loja: vira orçamento "site" na Gestão da loja e
 * avisa quem vende. Preço, frete e estoque são conferidos no banco.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/vitrine/[slug]/pedidos">) {
  const { slug } = await ctx.params;
  const chave = chaveDaRequisicao(req);
  if (!chave || !SLUG_LOJA.test(slug)) return NextResponse.json({ ok: false, mensagem: "Loja não encontrada." }, { status: 404 });
  const cliente = (req.headers.get("x-cliente-ip") ?? "").slice(0, 64) || "desconhecido";
  if (!porCliente(`${slug}:${cliente}`) || !porLoja(slug)) {
    return NextResponse.json({ ok: false, mensagem: "Muitos pedidos em pouco tempo. Aguarde alguns minutos ou fale com a loja pelo WhatsApp." }, { status: 429 });
  }
  const bruto = await req.text();
  if (bruto.length > 20_000) return NextResponse.json({ ok: false, mensagem: "Pedido grande demais." }, { status: 413 });
  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 400 });
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return NextResponse.json({ ok: false, mensagem: "Pedido inválido." }, { status: 400 });
  try {
    const r = await registrarPedidoSite(slug, chave, corpo as Record<string, unknown>);
    if (r.ok) return NextResponse.json(r, { status: 201, headers: { "Cache-Control": "no-store" } });
    const { naoEncontrada, ...resposta } = r;
    return NextResponse.json(resposta, { status: naoEncontrada ? 404 : 422 });
  } catch {
    return NextResponse.json({ ok: false, mensagem: "Não foi possível registrar o pedido agora." }, { status: 503 });
  }
}
