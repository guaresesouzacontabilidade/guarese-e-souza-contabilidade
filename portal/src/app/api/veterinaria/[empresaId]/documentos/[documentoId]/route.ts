import { NextResponse, type NextRequest } from "next/server";
import { entregarPdf, sessaoClinica } from "@/lib/veterinaria/api";
import { pdfDocumento } from "@/lib/veterinaria/pdf";

/** Atestado ou termo de consentimento em PDF (2 vias; o atestado sanitário sai em via única). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; documentoId: string }> }) {
  const { empresaId, documentoId } = await params;
  const s = await sessaoClinica(empresaId, documentoId);
  if (s instanceof NextResponse) return s;
  return entregarPdf(() => pdfDocumento(s.supabase, empresaId, documentoId), "documento");
}
