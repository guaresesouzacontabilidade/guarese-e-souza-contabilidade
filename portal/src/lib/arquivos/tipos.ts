/** Tipos de arquivo aceitos e verificação pela assinatura (bytes iniciais). */

export type Familia = "pdf" | "jpeg" | "png" | "webp" | "heic" | "gif" | "zip" | "ole" | "texto" | "desconhecido";

export const MIME_POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  xml: "application/xml",
  zip: "application/zip",
  ofx: "application/x-ofx",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

/** Arquivos que podem ser exibidos no navegador com segurança (os demais são baixados). */
export const MIME_VISUALIZACAO_SEGURA = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

const FAMILIAS_POR_EXTENSAO: Record<string, Familia[]> = {
  pdf: ["pdf"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  png: ["png"],
  webp: ["webp"],
  heic: ["heic"],
  xml: ["texto"],
  ofx: ["texto"],
  csv: ["texto"],
  txt: ["texto"],
  zip: ["zip"],
  xlsx: ["zip"],
  docx: ["zip"],
  xls: ["ole", "texto"],
  doc: ["ole"],
};

export function extensaoDe(nome: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nome);
  return m ? m[1].toLowerCase() : "";
}

export function mimeDe(nome: string) {
  return MIME_POR_EXTENSAO[extensaoDe(nome)] ?? "application/octet-stream";
}

export function detectarFamilia(b: Uint8Array): Familia {
  const ini = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);
  if (ini(0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (ini(0xff, 0xd8, 0xff)) return "jpeg";
  if (ini(0x89, 0x50, 0x4e, 0x47)) return "png";
  if (ini(0x47, 0x49, 0x46, 0x38)) return "gif";
  if (ini(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const marca = String.fromCharCode(...b.slice(8, 12));
    if (/heic|heix|hevc|heim|heis|mif1|msf1/.test(marca)) return "heic";
  }
  if (ini(0x50, 0x4b, 0x03, 0x04) || ini(0x50, 0x4b, 0x05, 0x06)) return "zip";
  if (ini(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "ole";
  if (pareceTexto(b)) return "texto";
  return "desconhecido";
}

function pareceTexto(b: Uint8Array) {
  const n = Math.min(b.length, 8192);
  if (n === 0) return false;
  let controle = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) controle++;
  }
  return controle / n < 0.02;
}

export interface Verificacao {
  ok: boolean;
  familia: Familia;
  motivo?: string;
}

/** Confere se o conteúdo corresponde à extensão (evita arquivos disfarçados). */
export function verificarConteudo(nome: string, bytes: Uint8Array): Verificacao {
  const ext = extensaoDe(nome);
  const familia = detectarFamilia(bytes);
  const esperadas = FAMILIAS_POR_EXTENSAO[ext];
  if (!esperadas) return { ok: false, familia, motivo: `Extensão .${ext || "?"} não permitida.` };
  if (!esperadas.includes(familia)) {
    return { ok: false, familia, motivo: `O conteúdo do arquivo (${familia}) não corresponde à extensão .${ext}.` };
  }
  if (familia === "texto") {
    const inicio = new TextDecoder("latin1").decode(bytes.slice(0, 2048)).toLowerCase();
    if (/<script|<html|<iframe|javascript:/.test(inicio) && ext !== "xml") {
      return { ok: false, familia, motivo: "Conteúdo HTML/script não é permitido neste tipo de arquivo." };
    }
    if (ext === "xml" && !/^\s*(<\?xml|<)/.test(inicio.replace(/^﻿/, ""))) {
      return { ok: false, familia, motivo: "O arquivo .xml não contém XML." };
    }
  }
  if (familia === "pdf") {
    const amostra = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 2_000_000)));
    if (/\/JavaScript|\/JS[\s(<]|\/Launch/.test(amostra)) {
      return { ok: false, familia, motivo: "PDF com JavaScript ou ação de execução não é aceito por segurança." };
    }
  }
  return { ok: true, familia };
}
