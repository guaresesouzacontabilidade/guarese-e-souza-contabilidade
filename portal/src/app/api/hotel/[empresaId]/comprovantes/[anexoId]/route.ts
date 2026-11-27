import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { exibeNoNavegador } from "@/lib/hotel/comprovante-arquivo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Abre (ou baixa) o comprovante de um recebimento do hotel: só a recepção e o
 * gerente do hotel da própria empresa; redireciona para um link temporário
 * (2 minutos) do armazenamento privado. O banco confere o acesso de novo.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; anexoId: string }> }) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { empresaId, anexoId } = await params;
  if (!UUID.test(empresaId) || !UUID.test(anexoId)) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "hotel" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  const { data: anexo } = await s.supabase
    .from("hotel_pagamento_anexos")
    .select("empresa_id, caminho, nome, mime, confirmado_em")
    .eq("id", anexoId)
    .maybeSingle();
  if (!anexo || anexo.empresa_id !== empresaId || !anexo.confirmado_em) return new NextResponse("Comprovante não encontrado.", { status: 404 });
  const { data: link, error } = await s.supabase.storage
    .from("hotel-comprovantes")
    .createSignedUrl(anexo.caminho, 120, exibeNoNavegador(anexo.mime) ? undefined : { download: anexo.nome });
  if (error || !link) return new NextResponse("Arquivo indisponível no momento.", { status: 404 });
  const r = NextResponse.redirect(link.signedUrl, 302);
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
