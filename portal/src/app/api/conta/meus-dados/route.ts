import { NextResponse } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";

/** Cópia dos dados pessoais do usuário (LGPD, art. 18), em JSON. */
export async function GET() {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { data, error } = await s.supabase.rpc("exportar_meus_dados");
  if (error) return new NextResponse("Não foi possível gerar a cópia dos dados.", { status: 500 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meus-dados-portal-guareses-on.json"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
