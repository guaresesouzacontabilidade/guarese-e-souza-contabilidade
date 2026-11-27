import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

async function sair(request: NextRequest) {
  const motivo = request.nextUrl.searchParams.get("motivo") ?? "saiu";
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
    await supabase.rpc("registrar_evento", {
      p_acao: "logout",
      p_entidade: "sessoes",
      p_entidade_id: (data.claims.session_id as string | undefined) ?? undefined,
      p_ip: ip,
      p_user_agent: request.headers.get("user-agent") ?? undefined,
    });
  }
  await supabase.auth.signOut({ scope: "local" });
  const destino = request.nextUrl.clone();
  destino.pathname = "/login";
  destino.search = `?motivo=${encodeURIComponent(["inativo", "sessao", "saiu", "fechado"].includes(motivo) ? motivo : "saiu")}`;
  return NextResponse.redirect(destino, { status: 303 });
}

export const GET = sair;
export const POST = sair;
