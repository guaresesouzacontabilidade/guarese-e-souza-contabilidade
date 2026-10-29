import { NextResponse, type NextRequest } from "next/server";
import { entregarPdf, sessaoClinica } from "@/lib/veterinaria/api";
import { pdfReceita } from "@/lib/veterinaria/pdf";

/** Receita em PDF, com as vias do tipo (comum: 2; antimicrobiano: 2; manipulado controlado: 3). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ empresaId: string; receitaId: string }> }) {
  const { empresaId, receitaId } = await params;
  const s = await sessaoClinica(empresaId, receitaId);
  if (s instanceof NextResponse) return s;
  return entregarPdf(() => pdfReceita(s.supabase, empresaId, receitaId), "receita");
}
