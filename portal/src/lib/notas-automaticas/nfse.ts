import { gunzipSync } from "node:zlib";
import type { Ambiente } from "./nfe";

/**
 * NFS-e no Ambiente de Dados Nacional (ADN): distribuição dos documentos da
 * empresa (como prestadora, tomadora ou intermediária) por NSU, em lotes de
 * até 50, com o certificado da empresa na conexão. Endereço conferido em
 * 02/10/2026 (o serviço exige o certificado). A leitura da resposta tolera
 * variações de maiúsculas nos nomes dos campos.
 */
export const URLS_NFSE = {
  producao: "https://adn.nfse.gov.br/contribuintes",
  homologacao: "https://adn.producaorestrita.nfse.gov.br/contribuintes",
} as const;

export function urlDistribuicaoNfse(nsu: number, ambiente: Ambiente, base: string = URLS_NFSE[ambiente]) {
  return `${base}/DFe/${Math.max(0, Math.trunc(nsu))}?lote=true`;
}

export interface DocumentoNfse {
  nsu: number;
  chave: string | null;
  /** "NFSE" | "EVENTO" | outro */
  tipo: string;
  xml: string;
}

export interface RetornoNfse {
  situacao: "documentos" | "nenhum" | "erro";
  documentos: DocumentoNfse[];
  mensagem: string | null;
}

type Obj = Record<string, unknown>;

/** Códigos do ADN que só informam que não há documento novo a partir do NSU pedido. */
const SEM_DOCUMENTOS_NOVOS = new Set(["E2220"]);

function campo(o: unknown, nome: string): unknown {
  if (!o || typeof o !== "object") return undefined;
  const alvo = nome.toLowerCase();
  for (const [k, v] of Object.entries(o as Obj)) if (k.toLowerCase() === alvo) return v;
  return undefined;
}

function conteudoXml(base64: string): string {
  const b = Buffer.from(base64, "base64");
  return (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString("utf8");
}

export function lerRetornoNfse(corpo: string, status: number): RetornoNfse {
  // Sem conteúdo: nenhum documento novo
  if (!corpo.trim() && (status === 204 || status === 404 || status === 200)) return { situacao: "nenhum", documentos: [], mensagem: null };
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    const motivo = status === 401 || status === 403 ? "o certificado da empresa não foi aceito" : "resposta em formato inesperado";
    return { situacao: "erro", documentos: [], mensagem: `Ambiente Nacional da NFS-e: ${motivo} (HTTP ${status}).` };
  }
  const erros = (campo(json, "Erros") as unknown[] | undefined) ?? [];
  const situacao = String(campo(json, "StatusProcessamento") ?? "").toUpperCase();
  // E2220 ("Nenhum documento localizado... a partir do NSU informado") vem na lista
  // de erros, mas só quer dizer que não há documento novo: não é falha da consulta
  const codigos = erros.map((e) => String(campo(e, "Codigo") ?? "").toUpperCase());
  if (erros.length && codigos.every((c) => SEM_DOCUMENTOS_NOVOS.has(c))) return { situacao: "nenhum", documentos: [], mensagem: null };
  if (erros.length || situacao === "REJEICAO" || (status >= 400 && status !== 404)) {
    const mensagem =
      erros
        .map((e) => [campo(e, "Codigo"), campo(e, "Descricao")].filter(Boolean).join(": "))
        .filter(Boolean)
        .join("; ") || `Ambiente Nacional da NFS-e recusou a consulta (HTTP ${status}).`;
    return { situacao: "erro", documentos: [], mensagem: mensagem.slice(0, 900) };
  }
  const lote = (campo(json, "LoteDFe") as unknown[] | undefined) ?? [];
  const documentos: DocumentoNfse[] = [];
  for (const d of lote) {
    const nsu = Number(campo(d, "NSU"));
    const arquivo = campo(d, "ArquivoXml");
    if (!Number.isFinite(nsu) || typeof arquivo !== "string") continue;
    documentos.push({
      nsu,
      chave: (campo(d, "ChaveAcesso") as string | undefined) ?? null,
      tipo: String(campo(d, "TipoDocumento") ?? "").toUpperCase() || "DESCONHECIDO",
      xml: conteudoXml(arquivo),
    });
  }
  documentos.sort((a, b) => a.nsu - b.nsu);
  return { situacao: documentos.length ? "documentos" : "nenhum", documentos, mensagem: null };
}
