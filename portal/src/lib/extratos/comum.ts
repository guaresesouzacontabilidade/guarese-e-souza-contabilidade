import { validarCnpj, validarCpf } from "@/lib/formatos";

/** Estruturas e utilitários comuns aos leitores de extrato. */

export interface TransacaoExtrato {
  data: string; // AAAA-MM-DD
  valor: string; // decimal com sinal (+ crédito, − débito)
  descricao: string;
  documento: string | null; // CPF/CNPJ identificado
  fitid: string | null;
  tipo: string | null;
  numero: string | null;
  ocorrencia: number; // ordem entre lançamentos idênticos (deduplicação)
  linha?: number;
}

export interface LinhaInvalida {
  linha: number;
  motivo: string;
  conteudo?: string;
}

/** Normalização equivalente à usada pelo banco na chave de deduplicação. */
export function normalizarDescricao(t: string) {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/** Numera ocorrências de transações idênticas (mesma data, valor e descrição). */
export function numerarOcorrencias<T extends { data: string; valor: string; descricao: string }>(itens: T[]): (T & { ocorrencia: number })[] {
  const contagem = new Map<string, number>();
  return itens.map((t) => {
    const chave = `${t.data}|${Number(t.valor).toFixed(2)}|${normalizarDescricao(t.descricao.slice(0, 500))}`;
    const n = (contagem.get(chave) ?? 0) + 1;
    contagem.set(chave, n);
    return { ...t, ocorrencia: n };
  });
}

/** Identifica CPF/CNPJ válido dentro de um texto (descrições de PIX/TED). */
export function extrairDocumento(texto: string): string | null {
  const candidatos = [
    ...texto.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g),
    ...texto.matchAll(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g),
  ].map((m) => m[0].replace(/\D/g, ""));
  for (const c of candidatos) {
    if (c.length === 14 && validarCnpj(c)) return c;
    if (c.length === 11 && validarCpf(c)) return c;
  }
  return null;
}

/** Interpreta datas comuns em extratos brasileiros. Retorna AAAA-MM-DD ou null. */
export function lerData(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  const t = String(valor).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return validar(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (m) {
    let ano = Number(m[3]);
    if (ano < 100) ano += ano > 70 ? 1900 : 2000;
    return validar(ano, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);
  if (m) return validar(Number(m[1]), Number(m[2]), Number(m[3]));
  // Número serial do Excel
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Math.floor(Number(t));
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function validar(a: number, m: number, d: number): string | null {
  if (a < 1990 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Decodifica bytes de texto (UTF-8 ou Windows-1252). */
export function decodificarTexto(bytes: Uint8Array, dica?: string | null): string {
  const latin = dica && /1252|8859|latin|usascii/i.test(dica);
  if (!latin) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
    } catch {
      // não é UTF-8 válido: cai para Windows-1252
    }
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

/** Linhas que representam saldos, e não movimentações. */
export function ehLinhaDeSaldo(descricao: string) {
  const d = normalizarDescricao(descricao).replace(/\s/g, "");
  return /^(SALDO|SALDOANTERIOR|SALDODODIA|SALDOFINAL|SALDOTOTAL|SALDOINICIAL|SALDOEMCONTA|SDOANTERIOR|SALDODISPONIVEL|SALDOBLOQUEADO)/.test(d) ||
    /^S A L D O/.test(normalizarDescricao(descricao));
}
