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

/** Endereço da distribuição por NSU; com `cnpjConsulta`, informa o CNPJ consultado (o do certificado, ou outro da mesma raiz). */
export function urlDistribuicaoNfse(nsu: number, ambiente: Ambiente, base: string = URLS_NFSE[ambiente], cnpjConsulta?: string) {
  const cnpj = (cnpjConsulta ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return `${base}/DFe/${Math.max(0, Math.trunc(nsu))}?lote=true${cnpj ? `&cnpjConsulta=${cnpj}` : ""}`;
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
  /** "REJEICAO" sem nenhum código ou texto de erro (resposta do ADN desde 31/10/2026, inclusive quando não há nota nova). */
  semMotivo?: boolean;
}

type Obj = Record<string, unknown>;

/** Códigos do ADN que só informam que não há documento novo a partir do NSU pedido. */
const SEM_DOCUMENTOS_NOVOS = new Set(["E2220"]);
/** Situações do ADN que querem dizer "nada novo" (o HTTP pode vir 200, 400 ou 404). */
const SITUACOES_SEM_DOCUMENTOS = new Set(["NENHUM_DOCUMENTO_LOCALIZADO"]);

/** Trecho da resposta para o histórico, sem CPF/CNPJ e sem quebras de linha. */
function trechoResposta(corpo: string): string {
  return corpo
    .replace(/\d{11,14}/g, "[documento]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Lista de erros do ADN, aceitando lista, objeto único ou o formato padrão de erro de API (title/detail/errors). */
function errosDaResposta(json: unknown): { codigo: string; descricao: string }[] {
  const bruto = campo(json, "Erros") ?? campo(json, "Erro");
  const lista = Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" ? [bruto] : [];
  const erros = lista.map((e) => ({
    codigo: String(campo(e, "Codigo") ?? "").trim().toUpperCase(),
    descricao: String(campo(e, "Descricao") ?? campo(e, "Mensagem") ?? "").trim(),
  }));
  // Formato padrão de erro de API: {"title": ..., "detail": ..., "errors": {"campo": ["motivo"]}}
  const validacao = campo(json, "errors");
  if (validacao && typeof validacao === "object" && !Array.isArray(validacao)) {
    for (const [nome, motivos] of Object.entries(validacao as Obj)) {
      erros.push({ codigo: "", descricao: `${nome}: ${(Array.isArray(motivos) ? motivos : [motivos]).map(String).join(", ")}` });
    }
  }
  return erros.filter((e) => e.codigo || e.descricao);
}

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
  const erros = errosDaResposta(json);
  const situacao = String(campo(json, "StatusProcessamento") ?? "").toUpperCase();
  // E2220 ("Nenhum documento localizado... a partir do NSU informado") vem na lista
  // de erros, mas só quer dizer que não há documento novo: não é falha da consulta
  if (erros.length && erros.every((e) => SEM_DOCUMENTOS_NOVOS.has(e.codigo))) return { situacao: "nenhum", documentos: [], mensagem: null };
  // "Nenhum documento localizado" sem outro erro: nada novo, qualquer que seja o HTTP
  // (o ADN passou a responder assim com HTTP 400 a partir de 31/10/2026)
  if (!erros.length && SITUACOES_SEM_DOCUMENTOS.has(situacao)) return { situacao: "nenhum", documentos: [], mensagem: null };
  const lote0 = campo(json, "LoteDFe");
  const titulo0 = [campo(json, "title"), campo(json, "detail"), campo(json, "Mensagem"), campo(json, "message")].some((v) => typeof v === "string" && v.trim());
  if (situacao === "REJEICAO" && !erros.length && !titulo0 && (!Array.isArray(lote0) || !lote0.length)) {
    return {
      situacao: "erro",
      documentos: [],
      mensagem: `Ambiente Nacional da NFS-e recusou a consulta sem informar o motivo (HTTP ${status}, REJEICAO sem código de erro).`,
      semMotivo: true,
    };
  }
  if (erros.length || situacao === "REJEICAO" || (status >= 400 && status !== 404)) {
    const lidos = erros.map((e) => [e.codigo, e.descricao].filter(Boolean).join(": ")).join("; ");
    const titulo = [campo(json, "title"), campo(json, "detail"), campo(json, "Mensagem"), campo(json, "message")]
      .filter((v) => typeof v === "string" && v.trim())
      .join(" — ");
    const mensagem =
      lidos ||
      (titulo
        ? `Ambiente Nacional da NFS-e recusou a consulta (HTTP ${status}): ${titulo}`
        : `Ambiente Nacional da NFS-e recusou a consulta (HTTP ${status}). Resposta: ${trechoResposta(corpo)}`);
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
