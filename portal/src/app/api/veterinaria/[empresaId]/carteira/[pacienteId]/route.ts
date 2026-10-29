import { NextResponse, type NextRequest } from "next/server";
import { entregarPdf, sessaoClinica } from "@/lib/veterinaria/api";
import { pdfCarteira } from "@/lib/veterinaria/pdf";

/** Carteira de vacinação do animal em PDF (vacinas aplicadas e próximas doses). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; pacienteId: string }> }) {
  const { empresaId, pacienteId } = await params;
  const s = await sessaoClinica(empresaId, pacienteId);
  if (s instanceof NextResponse) return s;
  return entregarPdf(() => pdfCarteira(s.supabase, empresaId, pacienteId), "carteira");
}
