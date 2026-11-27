import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/requisicao";
import { COOKIE_PRESENCA, PRESENCA_SEGUNDOS } from "@/lib/auth/presenca";

/**
 * Retorno dos links enviados pelo próprio Supabase Auth (quando o SMTP do
 * escritório não está configurado): troca o código de uso único por sessão.
 */
export async function GET(req: NextRequest) {
  const codigo = req.nextUrl.searchParams.get("code");
  const proximo = destinoSeguro(req.nextUrl.searchParams.get("next"), "/painel");
  if (!codigo) return NextResponse.redirect(new URL("/login?erro=link", req.url));
  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(codigo);
  if (error) return NextResponse.redirect(new URL("/login?erro=link", req.url));
  const resposta = NextResponse.redirect(new URL(proximo, req.url));
  resposta.cookies.set(COOKIE_PRESENCA, "1", { maxAge: PRESENCA_SEGUNDOS, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return resposta;
}
