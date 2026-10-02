"use server";

import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";

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
