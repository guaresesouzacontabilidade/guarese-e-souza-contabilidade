import { NextResponse, type NextRequest } from "next/server";
import { sessaoApi } from "@/lib/auth/sessao";
import { logosDaEmpresa } from "@/lib/marca/logos-relatorio";
import { gerarPdfOrdem, type OrdemPdf } from "@/lib/gestao/pdf-carregamento";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/** Ordem de carregamento em PDF. O acesso segue as regras do banco (quem emite NF-e na empresa). */
export async function GET(req: NextRequest, { params }: RouteContext<"/api/loja/carregamentos/[ordemId]/pdf">) {
  const s = await sessaoApi();
  if (!s)
    return new NextResponse("Sessão expirada. Entre novamente.", {
      status: 401,
    });
  const { ordemId } = await params;
  if (!UUID.test(ordemId)) return new NextResponse("Ordem inválida.", { status: 400 });
  const { data: o } = await s.supabase
    .from("ordens_carregamento")
    .select("*, produto:nfe_produtos(peso_kg), emitente:nfe_emitentes(inscricao_estadual), nota:nfe_emissoes(numero, serie, situacao)")
    .eq("id", ordemId)
    .maybeSingle();
  if (!o) return new NextResponse("Ordem não encontrada.", { status: 404 });
  const [{ data: empresa }, { data: cfg }, { data: emitentes }] = await Promise.all([
    s.supabase.from("empresas").select("razao_social, nome_fantasia, documento, logo_path, demonstracao").eq("id", o.empresa_id).maybeSingle(),
    s.supabase.from("gestao_config").select("mensagem_comprovante").eq("empresa_id", o.empresa_id).maybeSingle(),
    s.supabase.from("nfe_emitentes").select("inscricao_estadual").eq("empresa_id", o.empresa_id).eq("ativo", true).limit(2),
  ]);
  if (!empresa) return new NextResponse("Ordem não encontrada.", { status: 404 });
  const logos = await logosDaEmpresa(s.supabase, empresa.logo_path);
  // Inscrição de quem vende: a da ordem ou, se a empresa só tem uma, essa
  const inscricao =
    (o.emitente as { inscricao_estadual: string } | null)?.inscricao_estadual ?? (emitentes?.length === 1 ? emitentes[0].inscricao_estadual : null);
  const nota = o.nota as {
    numero: number;
    serie: number;
    situacao: string;
  } | null;
  const arquivo = await gerarPdfOrdem({
    ordem: o as unknown as OrdemPdf,
    pesoKgUnidade: (o.produto as { peso_kg: number | null } | null)?.peso_kg ?? null,
    vendedor: {
      razao: empresa.razao_social,
      documento: empresa.documento,
      inscricao,
    },
    nota: nota && !["cancelada", "descartada"].includes(nota.situacao) ? { numero: nota.numero, serie: nota.serie } : null,
    mensagem: cfg?.mensagem_comprovante ?? null,
    demonstracao: empresa.demonstracao,
    logo: logos.cliente,
    logoEscritorio: logos.escritorio,
    geradoEm: new Date().toISOString(),
  });
  const nome = nomeArquivo(["ordem-carregamento", String(o.numero), empresa.nome_fantasia ?? empresa.razao_social], "pdf");
  const inline = req.nextUrl.searchParams.get("ver") === "1";
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
