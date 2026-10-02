import type { ZodError } from "zod";

/** Resultado padronizado das ações do servidor (formulários). */
export interface ResultadoAcao<T = unknown> {
  ok: boolean;
  mensagem?: string;
  erros?: Record<string, string[] | undefined>;
  dados?: T;
}

export const estadoInicial: ResultadoAcao = { ok: false };

export function sucesso<T>(mensagem?: string, dados?: T): ResultadoAcao<T> {
  return { ok: true, mensagem, dados };
}

export function falha(mensagem: string, erros?: Record<string, string[] | undefined>): ResultadoAcao<never> {
  return { ok: false, mensagem, erros };
}

export function falhaValidacao(erro: ZodError): ResultadoAcao<never> {
  const erros: Record<string, string[]> = {};
  for (const issue of erro.issues) {
    const chave = issue.path.join(".") || "_";
    (erros[chave] ??= []).push(issue.message);
  }
  return { ok: false, mensagem: "Revise os campos destacados.", erros };
}

interface ErroBanco {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Converte erros do Postgres/PostgREST em mensagens úteis em português.
 * Mensagens lançadas pelas funções do banco (raise exception) já estão em
 * português e são repassadas.
 */
export function mensagemErro(erro: unknown): string {
  const e = (erro ?? {}) as ErroBanco;
  const msg = e.message ?? (erro instanceof Error ? erro.message : "");
  switch (e.code) {
    case "42501":
      return msg && !/permission denied|row-level security/i.test(msg)
        ? msg
        : "Acesso negado: você não tem permissão para esta operação.";
    case "23505":
      return "Já existe um registro com estes dados (duplicidade).";
    case "23503":
      return "Referência inválida: um dos itens selecionados não existe ou pertence a outra empresa.";
    case "23514":
      return "Dados fora das regras permitidas. Revise os valores informados.";
    case "22P02":
      return "Formato de dado inválido.";
    case "PGRST116":
      return "Registro não encontrado.";
    default:
      break;
  }
  if (/JWT|not authenticated|Auth session missing/i.test(msg)) return "Sua sessão expirou. Entre novamente.";
  if (/Failed to fetch|fetch failed|ECONNREFUSED/i.test(msg)) return "Não foi possível conectar ao servidor. Tente novamente em instantes.";
  return msg || "Não foi possível concluir a operação.";
}
