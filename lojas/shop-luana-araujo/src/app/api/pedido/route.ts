import { NextResponse, type NextRequest } from "next/server";
import { enviarPedido } from "@/lib/portal";
import { criarLimitador, validarPedido } from "@/lib/validar-pedido";

const porEndereco = criarLimitador(8, 10 * 60_000);

/** Recebe o pedido da sacola e repassa ao portal com a chave do site (que fica só aqui no servidor). */
export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "desconhecido";
  if (!porEndereco(ip)) {
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
  const v = validarPedido(corpo);
  if (!v.ok) return NextResponse.json({ ok: false, mensagem: v.mensagem }, { status: v.robo ? 200 : 422 });
  try {
    const r = await enviarPedido(v.dados, ip);
    return NextResponse.json(r, { status: r.ok ? 201 : 422, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false, mensagem: "Não conseguimos registrar o pedido agora. Tente de novo em instantes ou fale com a loja pelo WhatsApp." },
      { status: 502 },
    );
  }
}
