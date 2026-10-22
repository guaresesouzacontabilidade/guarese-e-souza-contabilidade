import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { logoCliente } from "@/lib/declaracoes/carregar";
import { carregarRelatorioCaixa } from "@/lib/gestao/dados";
import { gerarPdfRelatorioCaixa } from "@/lib/gestao/pdf";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** Relatório do dia do caixa em PDF. O acesso segue as regras do banco (gestao.vender). */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/loja/caixa/[sessaoId]/relatorio">) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const { sessaoId } = await params;
  if (!UUID.test(sessaoId)) return new NextResponse("Caixa inválido.", { status: 400 });
  const relatorio = await carregarRelatorioCaixa(s.supabase, sessaoId);
  if (!relatorio) return new NextResponse("Caixa não encontrado.", { status: 404 });
  const { data: empresa } = await s.supabase
    .from("empresas")
    .select("razao_social, nome_fantasia, documento, logo_path")
    .eq("id", relatorio.sessao.empresa_id)
    .maybeSingle();
  if (!empresa) return new NextResponse("Caixa não encontrado.", { status: 404 });
  const arquivo = await gerarPdfRelatorioCaixa({
    relatorio,
    empresa: { nome: empresa.nome_fantasia ?? empresa.razao_social, razao: empresa.razao_social, documento: empresa.documento },
    logo: await logoCliente(s.supabase, empresa.logo_path),
    geradoEm: new Date().toISOString(),
  });
  const nome = nomeArquivo(["caixa", empresa.nome_fantasia ?? empresa.razao_social, relatorio.sessao.data, relatorio.sessao.caixa_nome], "pdf");
  const inline = req.nextUrl.searchParams.get("ver") === "1";
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
