import "server-only";
import { z } from "zod";

/**
 * Sugestão da IA (Claude, da Anthropic) para ligar um registro duvidoso do
 * sistema (ex.: um caixa fechado num dia fora da rotina) à tarefa certa do
 * quadro. Só indica a mais provável: uma pessoa sempre confirma antes de concluir.
 *
 * O que vai no pedido: o tipo do registro, a data e a hora, o nome do caixa
 * (ex.: "Caixa 1") e, de cada tarefa candidata, o título, o período, o prazo e
 * a situação. Não vão nomes de pessoas, valores, documentos nem dados da
 * empresa. Pela política comercial da Anthropic, o que passa pela API não é
 * usado para treinar modelos sem permissão expressa.
 */

export const SISTEMA_RH = `Você ajuda uma empresa a ligar um registro do próprio sistema (fechamento de caixa ou conferência de estoque) à tarefa certa de um quadro de tarefas recorrentes.
Responda em português do Brasil.
Escolha, entre as tarefas candidatas numeradas, a que mais provavelmente corresponde ao registro, olhando o período de cada tarefa, o prazo e a data e a hora do registro (um caixa aberto num dia e fechado depois da meia-noite pertence ao dia em que foi aberto; um registro num dia fora da rotina costuma cobrir a tarefa atrasada mais recente).
Se nenhuma servir, devolva indice = null.
Explique a escolha em até duas frases simples, sem jargão. Não invente dados que não estão no pedido.`;

export const respostaRh = z.object({
  indice: z.number().int().min(1).nullable(),
  explicacao: z.string().min(1).max(400),
});

export interface RegistroIa {
  tipo: "caixa_sessao" | "estoque_conferencia";
  quando: string;
  caixa?: string | null;
  dataDoCaixa?: string | null;
}

export interface CandidataIa {
  titulo: string;
  periodo: string;
  prazo: string;
  status: string;
}

/** Monta o pedido só com o que a IA precisa (sem nomes de pessoas nem valores). */
export function montarPedidoRh(
  registro: RegistroIa,
  candidatas: CandidataIa[],
) {
  const reg =
    registro.tipo === "caixa_sessao"
      ? `Fechamento do ${registro.caixa ?? "caixa"} do dia ${registro.dataDoCaixa ?? "?"}, registrado em ${registro.quando}.`
      : `Conferência do estoque confirmada em ${registro.quando}.`;
  return [
    `Registro: ${reg}`,
    "",
    "Tarefas candidatas:",
    ...candidatas.map(
      (c, i) =>
        `${i + 1}. ${c.titulo} — período: ${c.periodo}; prazo: ${c.prazo}; situação: ${c.status}`,
    ),
  ].join("\n");
}
