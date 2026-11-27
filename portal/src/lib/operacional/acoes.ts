"use server";

import { revalidatePath } from "next/cache";
import { exigirEquipe } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerCompetencia } from "@/lib/competencia";
import type { ChaveEtapa } from "./mapa";

const UUID = /^[0-9a-f-]{36}$/i;
const ETAPAS: ChaveEtapa[] = ["documentos", "notas", "extrato", "impostos", "obrigacoes", "fechamento"];

function revalidar(empresaId?: string) {
  revalidatePath("/escritorio/mapa", "layout");
  if (empresaId) revalidatePath(`/e/${empresaId}`, "layout");
}

/** A equipe marca a etapa como concluída no mês ou como "não se aplica" (no mês ou em todos os meses). */
export async function marcarEtapa(
  empresaId: string,
  etapa: ChaveEtapa,
  competencia: string,
  situacao: "concluida" | "nao_se_aplica",
  opcoes: { todas?: boolean; observacao?: string } = {},
): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !ETAPAS.includes(etapa) || !comp) return falha("Dados inválidos.");
  if (situacao !== "concluida" && situacao !== "nao_se_aplica") return falha("Situação inválida.");
  const todas = situacao === "nao_se_aplica" && !!opcoes.todas;
  const observacao = (opcoes.observacao ?? "").trim().slice(0, 500);
  const { error } = await s.supabase.rpc("operacional_marcar", {
    p_empresa_id: empresaId,
    p_etapa: etapa,
    p_competencia: comp,
    p_situacao: situacao,
    p_observacao: observacao || undefined,
    p_todas: todas,
  });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  if (situacao === "concluida") return sucesso("Etapa marcada como concluída. O mapa já foi atualizado.");
  return sucesso(todas ? 'Etapa marcada como "não se aplica" em todos os meses desta empresa.' : 'Etapa marcada como "não se aplica" neste mês.');
}

export async function desmarcarEtapa(empresaId: string, etapa: ChaveEtapa, competencia: string, todas: boolean): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !ETAPAS.includes(etapa) || !comp) return falha("Dados inválidos.");
  const { error } = await s.supabase.rpc("operacional_desmarcar", { p_empresa_id: empresaId, p_etapa: etapa, p_competencia: comp, p_todas: todas });
  if (error) return falha(mensagemErro(error));
  revalidar(empresaId);
  return sucesso("Marcação desfeita: a etapa voltou a mostrar o que os dados do portal dizem.");
}

/** Manda ao cliente o lembrete das pendências do checklist do mês (portal, e-mail e WhatsApp, quando ligados). */
export async function cobrarCliente(empresaId: string, competencia: string): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const comp = lerCompetencia(competencia);
  if (!UUID.test(empresaId) || !comp) return falha("Dados inválidos.");
  const { error } = await s.supabase.rpc("enviar_lembrete_manual", { p_empresa_id: empresaId, p_competencia: comp });
  if (error) return falha(mensagemErro(error));
  const { processarFilaDepois } = await import("@/lib/jobs/disparo");
  processarFilaDepois();
  revalidar(empresaId);
  return sucesso("Lembrete enviado ao cliente com a lista do que falta (no portal e pelos canais ligados: e-mail e WhatsApp).");
}

export async function anotar(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  const texto = String(fd.get("texto") ?? "").trim();
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  if (texto.length < 3) return falha("Escreva a anotação.", { texto: ["Escreva a anotação (pelo menos 3 letras)."] });
  if (texto.length > 1000) return falha("A anotação pode ter até 1000 caracteres.", { texto: ["Até 1000 caracteres."] });
  const { error } = await s.supabase.rpc("operacional_anotar", { p_empresa_id: empresaId, p_texto: texto });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Anotação salva. Só a equipe do escritório vê.");
}

export async function excluirAnotacao(id: string): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  if (!UUID.test(id)) return falha("Anotação inválida.");
  const { error } = await s.supabase.rpc("operacional_anotacao_excluir", { p_id: id });
  if (error) return falha(mensagemErro(error));
  revalidar();
  return sucesso("Anotação apagada.");
}
