"use server";

import { exigirEquipe, obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { competenciaAtual, lerCompetencia } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { tiposValidos } from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A lista de lotes aparece na mesma tela e o formulário atualiza a página depois
// de mostrar a mensagem: as ações não revalidam.

function lerPedido(fd: FormData) {
  const competencia = lerCompetencia(String(fd.get("competencia") ?? ""));
  const tipos = tiposValidos(fd.getAll("tipos").map(String));
  const erros: Record<string, string[]> = {};
  if (!competencia) erros.competencia = ["Escolha o mês."];
  else if (competencia > competenciaAtual()) erros.competencia = ["Escolha um mês que já começou."];
  if (!tipos.length) erros.tipos = ["Marque ao menos um tipo de nota."];
  return { competencia, tipos, erros };
}

export async function pedirLoteXml(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.baixar")) return falha("Seu acesso não permite baixar os documentos desta empresa.");
  const { competencia, tipos, erros } = lerPedido(fd);
  if (Object.keys(erros).length || !competencia) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.rpc("solicitar_lote_xml", { p_empresa_id: empresaId, p_competencia: competencia, p_tipos: tipos });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["gerar_lote_xml"], limite: 3 });
  return sucesso(`Gerando os XML de ${formatarCompetencia(competencia)}. O arquivo aparece na lista abaixo e você recebe um aviso quando ficar pronto.`);
}

export async function pedirLotesXmlCarteira(_anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const { competencia, tipos, erros } = lerPedido(fd);
  if (Object.keys(erros).length || !competencia) return falha("Revise os campos destacados.", erros);
  const { data, error } = await s.supabase.rpc("solicitar_lotes_xml_carteira", { p_competencia: competencia, p_tipos: tipos });
  if (error) return falha(mensagemErro(error));
  const empresas = (data as { empresas?: number } | null)?.empresas ?? 0;
  if (!empresas) return falha(`Nenhuma empresa da carteira tem notas desses tipos em ${formatarCompetencia(competencia)}.`);
  processarFilaDepois({ tipos: ["gerar_lote_xml"], limite: 5 });
  return sucesso(
    `Gerando os XML de ${formatarCompetencia(competencia)} de ${empresas} ${empresas === 1 ? "empresa" : "empresas"}. Pode levar alguns minutos; você recebe um aviso quando todos ficarem prontos.`,
  );
}
