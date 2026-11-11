import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { SISTEMA_ESCALAS } from "./ia-prompt";

/**
 * Chamada ao assistente de IA (Claude, da Anthropic) pela API comercial.
 *
 * - A chave fica cifrada no banco (tabela sem acesso pelo navegador) e só é
 *   aberta aqui, no servidor, na hora do pedido.
 * - Pela política comercial da Anthropic, o que passa pela API não é usado
 *   para treinar modelos sem permissão expressa, e as entradas e saídas são
 *   apagadas em até 30 dias (salvo abuso ou ordem legal).
 * - O pedido leva só apelidos (P1, P2...), cargo, jornada, restrições e
 *   horários; nunca nome, CPF ou salário (ver apelidos.ts e ia-prompt.ts).
 */

export const MODELOS_IA = [
  { id: "claude-opus-5-5", rotulo: "Claude Opus 5.5 (recomendado)" },
  { id: "claude-sonnet-5-5", rotulo: "Claude Sonnet 5.5 (mais barato)" },
] as const;

export class ErroIa extends Error {}

/** Chave e modelo do assistente, quando ligado (lidos só no servidor). */
export async function credencialIa(): Promise<{ chave: string; modelo: string } | null> {
  const admin = criarClienteAdmin();
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    admin.from("escritorio_ia").select("ativa, modelo").eq("id", 1).maybeSingle(),
    admin.from("escritorio_ia_segredo").select("chave_cifrada").eq("id", 1).maybeSingle(),
  ]);
  if (!cfg?.ativa || !seg?.chave_cifrada) return null;
  return { chave: decifrar(seg.chave_cifrada), modelo: cfg.modelo };
}

function cliente(chave: string, fetchTeste?: typeof fetch) {
  return new Anthropic({ apiKey: chave, maxRetries: 1, timeout: 170_000, ...(fetchTeste ? { fetch: fetchTeste } : {}) });
}

/** Mensagem simples para cada falha do serviço. */
export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroIa) return e.message;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return "A chave da Anthropic foi recusada. O administrador do escritório precisa conferir a chave em Configurações → Integrações.";
  if (e instanceof Anthropic.RateLimitError) return "O serviço de IA está com muitos pedidos agora. Tente de novo em alguns minutos.";
  if (e instanceof Anthropic.BadRequestError) return "O serviço de IA recusou o pedido. Tente escrever de outro jeito ou com menos detalhes.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "O serviço de IA demorou demais para responder. Tente de novo.";
  if (e instanceof Anthropic.APIConnectionError) return "Não foi possível falar com o serviço de IA agora. Tente de novo em instantes.";
  if (e instanceof Anthropic.APIError) return `O serviço de IA respondeu com erro (${e.status ?? "sem código"}). Tente de novo mais tarde.`;
  return "Não foi possível concluir o pedido ao assistente.";
}

export interface RespostaIa<T> {
  dados: T;
  tokensEntrada: number;
  tokensSaida: number;
}

/** Pede ao assistente uma resposta no formato do schema (saída estruturada). */
export async function perguntarIa<S extends z.ZodType>(
  credencial: { chave: string; modelo: string },
  pergunta: string,
  schema: S,
  opcoes: { fetch?: typeof fetch } = {},
): Promise<RespostaIa<z.infer<S>>> {
  // create (e não parse): assim a recusa e o limite de tamanho são conferidos antes de ler o JSON
  const resposta = await cliente(credencial.chave, opcoes.fetch).beta.messages.create({
    model: credencial.modelo,
    max_tokens: 16000,
    // Se o modelo recusar por engano (filtro de segurança), o próprio serviço tenta outro modelo
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
    system: SISTEMA_ESCALAS,
    messages: [{ role: "user", content: pergunta }],
  });
  if (resposta.stop_reason === "refusal") throw new ErroIa("O assistente não quis responder a este pedido. Escreva de outro jeito.");
  if (resposta.stop_reason === "max_tokens") throw new ErroIa("A resposta do assistente ficou grande demais. Peça menos coisas de uma vez.");
  const texto = resposta.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ErroIa("O assistente respondeu num formato inesperado. Tente de novo.");
  }
  const conferido = schema.safeParse(json);
  if (!conferido.success) throw new ErroIa("O assistente respondeu num formato inesperado. Tente de novo.");
  return {
    dados: conferido.data as z.infer<S>,
    tokensEntrada: resposta.usage.input_tokens + (resposta.usage.cache_read_input_tokens ?? 0) + (resposta.usage.cache_creation_input_tokens ?? 0),
    tokensSaida: resposta.usage.output_tokens,
  };
}

/** Testa a chave sem gastar créditos (consulta o modelo escolhido). */
export async function testarChave(chave: string, modelo: string, fetchTeste?: typeof fetch): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    await cliente(chave, fetchTeste).models.retrieve(modelo);
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) return { ok: false, erro: `O modelo ${modelo} não está disponível para esta chave.` };
    return { ok: false, erro: mensagemDeErro(e) };
  }
}
