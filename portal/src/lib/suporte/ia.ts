import "server-only";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { perguntarIa } from "@/lib/escalas/ia";
import type { Atalho } from "./busca";
import type { EntradaGuia } from "./guia";

/**
 * Suporte 24h com o assistente de IA (Claude, da Anthropic), quando o
 * administrador do escritório liga em Configurações → Integrações.
 *
 * O que vai no pedido: a pergunta da pessoa, os trechos do Guia de uso que a
 * busca encontrou e os nomes e endereços das telas que ela pode abrir. Não vão
 * dados da empresa, documentos, valores ou o nome de quem pergunta. Pela
 * política comercial da Anthropic, o que passa pela API não é usado para
 * treinar modelos sem permissão expressa.
 */

export const SISTEMA_SUPORTE = `Você é o suporte do Portal Guarese's ON, o portal de uma contabilidade (Guarese & Souza Contabilidade) usado por empresas clientes e pela equipe do escritório.
Responda em português do Brasil, em linguagem simples, curta e direta (até 120 palavras), como um atendente gentil explicando a alguém que não entende de tecnologia.
Use SOMENTE as informações dos trechos do guia enviados. Se os trechos não respondem, diga com honestidade que não encontrou no guia e sugira falar com o escritório (marque falar_com_escritorio = true). Nunca invente telas, botões, prazos, valores ou regras fiscais.
Para dúvidas sobre a situação da empresa (quanto pagar, se uma guia está certa, prazo de uma obrigação, dados da conta), oriente a falar com o escritório.
Quando ajudar, escolha até 3 telas da lista "Telas que a pessoa pode abrir", copiando exatamente o endereço (campo atalhos). Não invente endereços.
Os nomes de botões e menus aparecem entre aspas ou em negrito no guia: use os mesmos nomes.`;

const RESPOSTA = z.object({
  resposta: z.string().min(1).max(2000),
  atalhos: z.array(z.string()).max(3),
  falar_com_escritorio: z.boolean(),
});

export type RespostaSuporteIa = z.infer<typeof RESPOSTA>;

/** Chave e modelo do assistente, quando ligado no suporte (lidos só no servidor). */
export async function credencialSuporte(): Promise<{ chave: string; modelo: string } | null> {
  const admin = criarClienteAdmin();
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    admin.from("escritorio_ia").select("suporte_ativo, modelo").eq("id", 1).maybeSingle(),
    admin.from("escritorio_ia_segredo").select("chave_cifrada").eq("id", 1).maybeSingle(),
  ]);
  if (!cfg?.suporte_ativo || !seg?.chave_cifrada) return null;
  return { chave: decifrar(seg.chave_cifrada), modelo: cfg.modelo };
}

/** Monta o pedido (só a pergunta, os trechos do guia e as telas) e pede a resposta. */
export function montarPedido(pergunta: string, trechos: EntradaGuia[], atalhos: Atalho[]): string {
  return [
    `Pergunta: ${pergunta}`,
    "",
    "Trechos do guia:",
    ...trechos.map((t, i) => `[${i + 1}] ${t.titulo}\n${t.texto.slice(0, 1800)}`),
    "",
    "Telas que a pessoa pode abrir (nome — endereço):",
    ...atalhos.map((a) => `- ${a.grupo} › ${a.rotulo} — ${a.href}`),
  ].join("\n");
}

export async function responderComIa(
  credencial: { chave: string; modelo: string },
  pergunta: string,
  trechos: EntradaGuia[],
  atalhos: Atalho[],
  opcoes: { fetch?: typeof fetch } = {},
): Promise<{ dados: RespostaSuporteIa; tokensEntrada: number; tokensSaida: number }> {
  const r = await perguntarIa(credencial, montarPedido(pergunta, trechos, atalhos), RESPOSTA, {
    ...opcoes,
    sistema: SISTEMA_SUPORTE,
    esforco: "low",
    maxTokens: 2000,
  });
  const permitidos = new Set(atalhos.map((a) => a.href));
  return { ...r, dados: { ...r.dados, atalhos: r.dados.atalhos.filter((h) => permitidos.has(h)) } };
}
