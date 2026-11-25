"use server";

import { revalidatePath } from "next/cache";
import { criarClienteServidor } from "@/lib/supabase/server";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";

/** Resposta do paciente no link de confirmação (sem login; o banco confere o código e o horário). */
export async function responderConfirmacao(codigo: string, resposta: "confirmou" | "desmarcou", motivo?: string): Promise<ResultadoAcao> {
  if (!/^[a-z0-9]{16}$/.test(String(codigo ?? ""))) return falha("Link inválido.");
  if (resposta !== "confirmou" && resposta !== "desmarcou") return falha("Resposta inválida.");
  const supabase = await criarClienteServidor();
  const { error } = await supabase.rpc("fisio_confirmacao_responder", {
    p_codigo: codigo,
    p_resposta: resposta,
    p_motivo: String(motivo ?? "").slice(0, 200),
  });
  if (error) return falha(mensagemErro(error));
  revalidatePath(`/confirmar/${codigo}`);
  return sucesso(resposta === "confirmou" ? "Presença confirmada. Até logo!" : "Tudo bem, avisamos a clínica.");
}
