import "server-only";
import { NextResponse } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import type { ArquivoPdf } from "./pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sessão das rotas da clínica (PDFs e anexos): só a recepção e os
 * veterinários da própria clínica. O banco confere o acesso de novo em cada leitura.
 */
export async function sessaoClinica(empresaId: string, ...ids: string[]) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  if (![empresaId, ...ids].every((x) => UUID.test(x))) return new NextResponse("Parâmetros inválidos.", { status: 400 });
  const acesso = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!acesso || acesso.gestao_modalidade !== "veterinaria" || !acesso.permissoes.has("gestao.vender")) return new NextResponse("Acesso negado.", { status: 403 });
  return s;
}

export function respostaPdf(r: ArquivoPdf) {
  return new NextResponse(new Uint8Array(r.arquivo), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${r.nome}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Gera o PDF e trata o "não encontrado", o documento cancelado e a falha inesperada. */
export async function entregarPdf(gerar: () => Promise<ArquivoPdf | "cancelada" | "cancelado" | null>, contexto: string) {
  try {
    const r = await gerar();
    if (r === null) return new NextResponse("Documento não encontrado.", { status: 404 });
    if (r === "cancelada" || r === "cancelado") return new NextResponse(`Este documento foi ${r}. Emita outro, se precisar.`, { status: 409 });
    return respostaPdf(r);
  } catch (e) {
    console.error(`Falha ao gerar o PDF da clínica (${contexto})`, e);
    return new NextResponse("Não foi possível gerar o PDF. Tente novamente.", { status: 500 });
  }
}
