"use server";

import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { competenciaAtual } from "@/lib/competencia";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACOES = ["confirmar", "descartar", "publicar", "retirar", "resolver", "reabrir"] as const;
type AcaoRevisao = (typeof ACOES)[number];

const MENSAGEM: Record<AcaoRevisao, string> = {
  confirmar: "Achado confirmado.",
  descartar: "Achado descartado.",
  publicar: "Publicado ao cliente. Ele recebe um aviso no portal e por e-mail.",
  retirar: "Retirado do cliente. O achado voltou para a equipe.",
  resolver: "Achado concluído.",
  reabrir: "Achado reaberto.",
};

// As telas do auditor são dinâmicas e os formulários atualizam a página depois
// de mostrar a mensagem: as ações não revalidam (a resposta chegaria junto com
// a nova tela e o formulário sumiria antes da confirmação).

export async function analisarAgora(empresaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("auditor.gerenciar")) return falha("Seu acesso não permite iniciar a análise.");
  const { error } = await ctx.supabase.rpc("auditor_analisar", { p_empresa_id: empresaId });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["auditor_fiscal"], limite: 5 });
  return sucesso("Análise iniciada. Os achados aparecem aqui em instantes.");
}

export async function revisarAchado(
  empresaId: string,
  achadoId: string,
  acao: string,
  _anterior: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(achadoId) || !ACOES.includes(acao as AcaoRevisao)) return falha("Pedido inválido.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("auditor.gerenciar")) return falha("Seu acesso não permite revisar os achados.");
  const motivo = String(fd.get("motivo") ?? "").trim().slice(0, 1000);
  const texto = String(fd.get("texto_cliente") ?? "").trim().slice(0, 3000);
  if (acao === "descartar" && motivo.length < 5) return falha("Explique em poucas palavras por que o achado foi descartado.", { motivo: ["Informe o motivo."] });
  if (acao === "publicar" && texto.length < 10) return falha("Escreva a mensagem que o cliente vai ler.", { texto_cliente: ["Mensagem muito curta."] });
  const { error } = await ctx.supabase.rpc("auditor_revisar", {
    p_id: achadoId,
    p_acao: acao,
    p_motivo: motivo || (null as unknown as string),
    p_texto_cliente: texto || (null as unknown as string),
  });
  if (error) return falha(mensagemErro(error));
  if (acao === "publicar") processarFilaDepois({ tipos: ["enviar_envio"], limite: 10 });
  return sucesso(MENSAGEM[acao as AcaoRevisao]);
}

/** O cliente pede que o escritório cuide de uma oportunidade publicada (abre uma solicitação). */
export async function pedirAjudaAchado(empresaId: string, achadoId: string): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId) || !UUID.test(achadoId)) return falha("Pedido inválido.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("auditor.ver")) return falha("Seu acesso não permite este pedido.");
  const { data, error } = await ctx.supabase.rpc("auditor_pedir_ajuda", { p_id: achadoId });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["enviar_envio"], limite: 10 });
  return sucesso("Pedido enviado ao escritório. Acompanhe em Solicitações.", { solicitacao: data });
}

/**
 * Publica à empresa o relatório de correções (PDF e planilha) dos achados
 * escolhidos: os arquivos entram em Documentos (Relatórios) e o cliente é avisado.
 */
export async function publicarRelatorioCorrecoes(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("auditor.gerenciar") || !ctx.pode("documentos.publicar")) return falha("Seu acesso não permite publicar relatórios para o cliente.");
  const ids = [...new Set(fd.getAll("achado").map(String).filter((x) => UUID.test(x)))];
  if (!ids.length) return falha("Escolha pelo menos um achado para o relatório.");
  if (ids.length > 200) return falha("Escolha no máximo 200 achados.");
  const recado = String(fd.get("recado") ?? "").trim().slice(0, 2000) || null;
  const { data: empresa } = await ctx.supabase.from("empresas").select("razao_social, nome_fantasia, logo_path").eq("id", empresaId).single();
  if (!empresa) return falha("Empresa não encontrada.");
  const { gerarRelatorioCorrecoes, TITULO_RELATORIO_CORRECOES } = await import("./relatorio");
  const { publicarArquivoDoEscritorio } = await import("@/lib/documentos/publicar-servidor");
  const competencia = competenciaAtual();
  try {
    for (const formato of ["xlsx", "pdf"] as const) {
      const r = await gerarRelatorioCorrecoes(ctx.supabase, { id: empresaId, ...empresa }, ids, recado, formato);
      const pub = await publicarArquivoDoEscritorio(ctx.supabase, empresaId, {
        categoria: "esc_relatorio",
        competencia,
        nome: r.nome,
        mime: r.tipo,
        bytes: r.arquivo,
        titulo: `${TITULO_RELATORIO_CORRECOES}${formato === "xlsx" ? " — planilha de produtos" : ""} — ${r.dados.periodo}`,
      });
      if ("erro" in pub) return falha(pub.erro);
    }
  } catch (e) {
    return falha(e instanceof Error && e.message.startsWith("Nenhum achado") ? e.message : "Não foi possível gerar o relatório. Tente novamente.");
  }
  processarFilaDepois({ tipos: ["processar_documento", "enviar_envio"] });
  return sucesso("Relatório publicado: o PDF e a planilha estão em Documentos da empresa (Relatórios) e o cliente foi avisado.");
}
