"use server";

import { revalidatePath } from "next/cache";
import { exigirEquipe } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { processarFilaDepois } from "@/lib/jobs/disparo";

const UUID = /^[0-9a-f-]{36}$/i;

function revalidar(empresaId?: string) {
  revalidatePath("/escritorio/oportunidades", "layout");
  if (empresaId) revalidatePath(`/e/${empresaId}/calculos`, "layout");
}

/** "Rodar agora": uma empresa ou todas as que a pessoa atende. */
export async function rodarEstudos(empresaId?: string): Promise<ResultadoAcao<{ pedidos: number }>> {
  const s = await exigirEquipe();
  if (empresaId && !UUID.test(empresaId)) return falha("Empresa inválida.");
  const { data, error } = await s.supabase.rpc("estudo_rodar", { p_empresa_id: empresaId || undefined });
  if (error) return falha(mensagemErro(error));
  const pedidos = Number(data ?? 0);
  if (pedidos > 0) processarFilaDepois({ tipos: ["estudo_tributario"], limite: empresaId ? 5 : 40 });
  revalidar(empresaId);
  if (pedidos === 0) {
    return sucesso(empresaId ? "O robô já está estudando esta empresa. Aguarde alguns instantes." : "O robô já está estudando estas empresas. Aguarde alguns instantes.", { pedidos });
  }
  return sucesso(
    empresaId
      ? "O robô começou a estudar esta empresa. Em instantes o resultado aparece aqui."
      : `O robô começou a estudar ${pedidos} ${pedidos === 1 ? "empresa" : "empresas"}. Os resultados aparecem conforme ficam prontos.`,
    { pedidos },
  );
}

const ACOES_REVISAO = ["aprovar", "descartar", "apresentar", "reabrir"] as const;
export type AcaoRevisao = (typeof ACOES_REVISAO)[number];

/** Aprovar, descartar (com motivo), marcar como apresentado ao cliente ou reabrir (formulário). */
export async function revisarEstudo(id: string, acao: AcaoRevisao, _anterior: ResultadoAcao, form: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  if (!UUID.test(id) || !ACOES_REVISAO.includes(acao)) return falha("Dados inválidos.");
  const motivo = String(form.get("motivo") ?? "").trim().slice(0, 1000);
  if (acao === "descartar" && motivo.length < 5) {
    return falha("Revise os campos destacados.", { motivo: ["Explique em poucas palavras por que o estudo foi descartado."] });
  }
  const { data: estudo } = await s.supabase.from("estudo_oportunidades").select("empresa_id").eq("id", id).maybeSingle();
  const { error } = await s.supabase.rpc("estudo_revisar", { p_id: id, p_acao: acao, p_motivo: motivo || undefined });
  if (error) return falha(mensagemErro(error));
  revalidar(estudo?.empresa_id);
  const mensagens: Record<AcaoRevisao, string> = {
    aprovar: "Estudo aprovado. Agora você pode gerar o PDF para o cliente.",
    descartar: "Estudo descartado. O motivo fica guardado no histórico.",
    apresentar: "Marcado como apresentado ao cliente.",
    reabrir: "Estudo reaberto para nova revisão.",
  };
  return sucesso(mensagens[acao]);
}

function lerPercentual(v: FormDataEntryValue | null): number | null | undefined {
  const t = String(v ?? "").trim().replace("%", "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Premissas do comparativo de regimes guardadas na configuração da empresa. */
export async function salvarPremissas(empresaId: string, _anterior: ResultadoAcao, form: FormData): Promise<ResultadoAcao> {
  const s = await exigirEquipe();
  if (!UUID.test(empresaId)) return falha("Empresa inválida.");
  const margem = lerPercentual(form.get("margem_lucro"));
  const icms = lerPercentual(form.get("aliquota_icms_media"));
  if (margem === undefined) return falha("Revise os campos destacados.", { margem_lucro: ["Informe um número, por exemplo 15 ou 12,5."] });
  if (icms === undefined) return falha("Revise os campos destacados.", { aliquota_icms_media: ["Informe um número, por exemplo 7 ou 12."] });
  const { error } = await s.supabase.rpc("estudo_premissas_salvar", {
    p_empresa_id: empresaId,
    p_margem_lucro: margem as number,
    p_aliquota_icms: icms as number,
  });
  if (error) return falha(mensagemErro(error));
  // Estuda de novo com as premissas novas
  const { data } = await s.supabase.rpc("estudo_rodar", { p_empresa_id: empresaId });
  if (Number(data ?? 0) > 0) processarFilaDepois({ tipos: ["estudo_tributario"], limite: 5 });
  revalidar(empresaId);
  return sucesso("Premissas guardadas. O robô já está refazendo o estudo com elas.");
}
