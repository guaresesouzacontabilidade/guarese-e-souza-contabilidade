import { NextResponse } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { arquivoAssinado, gerarArquivoRecibo } from "@/lib/recibos/arquivo";
import { carregarRecibo } from "@/lib/recibos/carregar";
import { nomeArquivoRecibo } from "@/lib/recibos/pdf";
import { criarClienteAdmin } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f-]{36}$/i;

/** Recibo da cobrança paga: quem vê a cobrança (escritório autorizado ou o cliente dela) baixa o recibo. */
export async function GET(_req: Request, { params }: RouteContext<"/api/honorarios/[id]/recibo">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Cobrança inválida.", { status: 400 });
  const { data: c } = await s.supabase.from("honorarios_cobrancas").select("recibo_id, situacao").eq("id", id).maybeSingle();
  if (!c?.recibo_id || c.situacao !== "paga") return new NextResponse("Recibo não encontrado.", { status: 404 });
  const admin = criarClienteAdmin();
  const r = await carregarRecibo(admin, c.recibo_id);
  if (!r || r.linha.situacao !== "emitido") return new NextResponse("Recibo não encontrado.", { status: 404 });
  const pdf = (await arquivoAssinado(r.linha)) ?? (await gerarArquivoRecibo(admin, r.linha)).pdf;
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nomeArquivoRecibo(r.pdf)}"`, "Cache-Control": "no-store" },
  });
}
