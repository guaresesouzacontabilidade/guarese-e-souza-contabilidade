import { NextResponse, type NextRequest } from "next/server";
import { obterEmpresasDoUsuario, sessaoApi } from "@/lib/auth/sessao";
import { logoDoCliente } from "@/lib/marca/logos-relatorio";
import { ALVOS, PERIODOS, carregarAnaliseEstoque, opcao } from "@/lib/gestao/dados-analise";
import { pdfListaCompras, pdfPosicaoEstoque, planilhasEstoque } from "@/lib/gestao/relatorio-estoque";
import { bufferPlanilha, novaPasta } from "@/lib/relatorios/excel";
import { gerarPdf } from "@/lib/relatorios/pdf";
import { montarCabecalho, nomeArquivo } from "@/lib/relatorios/cabecalho";
import { formatarData, formatarDataHora } from "@/lib/formatos";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Posição do estoque e lista de compras (PDF) ou tudo em Excel. Mostra custos:
 * só quem gerencia a loja da empresa (o banco confere de novo nas funções).
 */
export async function GET(req: NextRequest) {
  const s = await sessaoApi();
  if (!s) return new NextResponse("Sessão expirada. Entre novamente.", { status: 401 });
  const q = req.nextUrl.searchParams;
  const empresaId = q.get("empresa") ?? "";
  if (!UUID.test(empresaId)) return new NextResponse("Empresa inválida.", { status: 400 });
  const empresa = (await obterEmpresasDoUsuario()).find((e) => e.id === empresaId);
  if (!empresa || !empresa.loja || empresa.gestao_modalidade === "notas" || !empresa.permissoes.has("gestao.gerenciar")) {
    return new NextResponse("Acesso negado.", { status: 403 });
  }
  const tipo = q.get("tipo") === "compras" ? "compras" : q.get("tipo") === "completo" ? "completo" : "posicao";
  const formato = q.get("formato") === "xlsx" || tipo === "completo" ? "xlsx" : "pdf";
  const dias = opcao(q.get("dias") ?? undefined, PERIODOS, 30);
  const alvo = opcao(q.get("alvo") ?? undefined, ALVOS, 30);

  let dados;
  try {
    dados = { ...(await carregarAnaliseEstoque(s.supabase, empresaId, dias)), dias, alvo };
  } catch {
    return new NextResponse("Não foi possível ler o estoque. Tente de novo.", { status: 500 });
  }
  const nomeEmpresa = empresa.nome_fantasia ?? empresa.razao_social;
  const titulo = tipo === "compras" ? "Lista de compras" : tipo === "completo" ? "Análise do estoque" : "Posição do estoque";
  const geradoEm = new Date().toISOString();

  if (formato === "xlsx") {
    const { data: e } = await s.supabase.from("empresas").select("logo_path").eq("id", empresaId).maybeSingle();
    const wb = novaPasta(nomeEmpresa);
    planilhasEstoque(
      wb,
      {
        titulo,
        empresa: empresa.razao_social,
        periodo: `posição em ${formatarData(dados.hoje)} · vendas de ${formatarData(dados.inicio)} a ${formatarData(dados.hoje)}`,
        situacao: "Pelo custo médio dos produtos",
        geradoEm: formatarDataHora(geradoEm),
        logos: { escritorio: null, cliente: await logoDoCliente(s.supabase, e?.logo_path) },
        marca: "empresa",
      },
      dados,
    );
    const nome = nomeArquivo(["analise-do-estoque", nomeEmpresa, dados.hoje], "xlsx");
    return new NextResponse(new Uint8Array(await bufferPlanilha(wb)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const cab = await montarCabecalho(s.supabase, empresaId, {
    titulo,
    subtitulo:
      tipo === "compras"
        ? `Estoque para ${alvo} dias no ritmo de venda de ${formatarData(dados.inicio)} a ${formatarData(dados.hoje)}`
        : `Posição em ${formatarData(dados.hoje)} · valores pelo custo médio`,
    situacao: "documento",
    geradoEm,
    notaFinal: null,
  });
  const arquivo = await gerarPdf(cab, tipo === "compras" ? pdfListaCompras(dados) : pdfPosicaoEstoque(dados));
  const nome = nomeArquivo([tipo === "compras" ? "lista-de-compras" : "posicao-do-estoque", nomeEmpresa, dados.hoje], "pdf");
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
