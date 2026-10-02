"use client";

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Envio de arquivos direto do navegador para o armazenamento privado, por URL
 * temporária gerada pelo servidor (o arquivo não passa pelo servidor da
 * aplicação). O SHA-256 calculado aqui é conferido depois no processamento.
 */

const BLOCO = 4 * 1024 * 1024;

export async function calcularSha256(arquivo: Blob, aoProgredir?: (fracao: number) => void, sinal?: AbortSignal) {
  const h = sha256.create();
  for (let inicio = 0; inicio < arquivo.size; inicio += BLOCO) {
    if (sinal?.aborted) throw new DOMException("Envio cancelado", "AbortError");
    const parte = new Uint8Array(await arquivo.slice(inicio, inicio + BLOCO).arrayBuffer());
    h.update(parte);
    aoProgredir?.(Math.min(1, (inicio + parte.length) / arquivo.size));
  }
  return bytesToHex(h.digest());
}

export class ErroEnvio extends Error {}

/** Envia o arquivo para a URL assinada, informando o progresso (0–1). */
export function enviarParaArmazenamento(url: string, arquivo: File, aoProgredir: (fracao: number) => void, sinal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (chave) xhr.setRequestHeader("apikey", chave);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        aoProgredir(1);
        resolve();
      } else {
        let detalhe = "";
        try {
          detalhe = JSON.parse(xhr.responseText)?.message ?? "";
        } catch {
          /* resposta sem JSON */
        }
        reject(new ErroEnvio(xhr.status === 413 ? "Arquivo maior que o limite permitido." : `Falha no envio (${xhr.status})${detalhe ? `: ${detalhe}` : ""}.`));
      }
    };
    xhr.onerror = () => reject(new ErroEnvio("Falha de conexão durante o envio. Verifique a internet e tente novamente."));
    xhr.onabort = () => reject(new DOMException("Envio cancelado", "AbortError"));
    sinal?.addEventListener("abort", () => xhr.abort(), { once: true });
    const corpo = new FormData();
    corpo.append("cacheControl", "3600");
    corpo.append("", arquivo);
    xhr.send(corpo);
  });
}

/** Lê o começo de um arquivo de texto (para sugerir categoria/competência). */
export async function lerInicio(arquivo: Blob, bytes = 64 * 1024) {
  const parte = new Uint8Array(await arquivo.slice(0, bytes).arrayBuffer());
  const ini = new TextDecoder("latin1").decode(parte.slice(0, 200));
  const iso = /encoding="(iso-8859-1|windows-1252)"/i.test(ini) || /CHARSET:1252|ENCODING:USASCII/i.test(ini);
  try {
    return new TextDecoder(iso ? "windows-1252" : "utf-8", { fatal: false }).decode(parte);
  } catch {
    return new TextDecoder("latin1").decode(parte);
  }
}

export function nomeFoto(arquivo: File) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = /\.([a-z0-9]{1,5})$/i.exec(arquivo.name)?.[1]?.toLowerCase() ?? (arquivo.type === "image/png" ? "png" : "jpg");
  return `foto-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}
