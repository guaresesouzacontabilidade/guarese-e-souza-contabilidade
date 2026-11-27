import { NextResponse, type NextRequest } from "next/server";
import { entregarPdf, sessaoClinica } from "@/lib/veterinaria/api";
import { pdfProntuario } from "@/lib/veterinaria/pdf";

/** Cópia do prontuário do animal em PDF (o tutor tem direito a ela; Res. CFMV nº 1.321/2020, art. 9º). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; pacienteId: string }> }) {
  const { empresaId, pacienteId } = await params;
  const s = await sessaoClinica(empresaId, pacienteId);
  if (s instanceof NextResponse) return s;
  return entregarPdf(() => pdfProntuario(s.supabase, empresaId, pacienteId, s.perfil.nome ?? s.email), "prontuario");
}
