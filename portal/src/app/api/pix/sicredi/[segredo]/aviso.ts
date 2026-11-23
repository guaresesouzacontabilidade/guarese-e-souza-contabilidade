import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";

/**
 * Aviso de Pix pago enviado pelo banco (webhook da API Pix). O endereço tem
 * um código secreto; o corpo não é confiável: só agenda a consulta ao banco,
 * que confirma (ou não) o pagamento antes da baixa.
 */
export async function receberAviso(req: Request, segredo: string) {
  const admin = criarClienteAdmin();
  const { data: cfg } = await admin.from("honorarios_config").select("banco_ativo, banco_webhook_segredo").eq("id", 1).single();
  const esperado = cfg?.banco_webhook_segredo ?? "";
  const ok = esperado.length === 40 && segredo.length === 40 && timingSafeEqual(Buffer.from(segredo), Buffer.from(esperado));
  if (!ok) return new NextResponse("Não encontrado.", { status: 404 });
  if (!cfg?.banco_ativo) return NextResponse.json({ ok: true, ignorado: true });
  const texto = (await req.text()).slice(0, 200_000);
  let txids: string[] = [];
  try {
    const corpo = JSON.parse(texto) as { pix?: { txid?: string; endToEndId?: string }[] };
    txids = [...new Set((corpo.pix ?? []).map((p) => p.txid ?? "").filter((t) => /^[A-Za-z0-9]{26,35}$/.test(t)))].slice(0, 100);
  } catch {
    return NextResponse.json({ ok: true, ignorado: "corpo inválido" });
  }
  if (txids.length) {
    await admin.from("jobs").upsert(
      { tipo: "pix_banco", payload: { acao: "conferir", txids }, chave_idempotencia: `pix_banco:conferir:${txids.join(",").slice(0, 200)}`, prioridade: 30 },
      { onConflict: "chave_idempotencia", ignoreDuplicates: true },
    );
  }
  return NextResponse.json({ ok: true });
}
