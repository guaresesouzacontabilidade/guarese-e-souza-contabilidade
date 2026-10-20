import { gunzipSync, gzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { requisitar, ErroConexao, type Credencial } from "@/lib/notas-automaticas/transporte";
import type { AmbienteNfse } from "./dps";

/**
 * API do Emissor Público Nacional (Sefin Nacional NFS-e), conforme o "Guia
 * para utilização das APIs do Emissor Público Nacional" (v1.2, out/2025):
 *  - POST /nfse: recebe a DPS assinada (compactada em GZip e em Base64, campo
 *    "dpsXmlGZipB64") e devolve, na hora, a NFS-e gerada ("nfseXmlGZipB64" e
 *    "chaveAcesso") ou a lista de erros da rejeição;
 *  - GET /dps/{id}: chave de acesso da NFS-e gerada a partir de uma DPS (para
 *    saber se uma tentativa sem resposta virou nota, sem emitir de novo);
 *  - GET /nfse/{chave}: a NFS-e pela chave;
 *  - POST /nfse/{chave}/eventos: pedido de registro de evento (cancelamento),
 *    campo "pedidoRegistroEventoXmlGZipB64".
 * A conexão exige o certificado A1 da empresa (TLS com certificado do cliente).
 * Endereços da produção restrita (testes, notas sem validade) e da produção.
 */
export const URLS_SEFIN: Record<AmbienteNfse, string> = {
  homologacao: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
  producao: "https://sefin.nfse.gov.br/SefinNacional",
};

export interface ErroSefin {
  codigo: string;
  descricao: string;
  complemento?: string | null;
}

export type ResultadoEmissao =
  | { situacao: "autorizada"; chave: string; xml: string }
  | { situacao: "rejeitada"; erros: ErroSefin[] };

export type ResultadoEvento = { situacao: "registrado"; xml: string | null } | { situacao: "rejeitado"; erros: ErroSefin[] };

export interface ConexaoSefin {
  base: string;
  credencial: Credencial;
  /** Só nos testes automáticos (servidor local) */
  ca?: string[];
}

export function compactar(xml: string): string {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function descompactar(b64: string): string {
  return gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
}

type Obj = Record<string, unknown>;

/** Campo do JSON sem depender de maiúsculas/minúsculas no nome. */
function campo(o: unknown, ...nomes: string[]): unknown {
  if (!o || typeof o !== "object") return undefined;
  const alvo = nomes.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(o as Obj)) if (alvo.includes(k.toLowerCase())) return v;
  return undefined;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

/** Lista de erros da resposta (vários formatos tolerados: "erros", "erro", "mensagens"). */
export function errosDaResposta(json: unknown): ErroSefin[] {
  const lista = campo(json, "erros", "erro", "mensagens", "alertas");
  const itens = Array.isArray(lista) ? lista : lista ? [lista] : [];
  const erros = itens
    .map((e) => ({
      codigo: texto(campo(e, "codigo", "code", "cod")) ?? "—",
      descricao: texto(campo(e, "descricao", "mensagem", "message", "description")) ?? "Erro sem descrição.",
      complemento: texto(campo(e, "complemento", "detalhe", "detail")),
    }))
    .slice(0, 50);
  if (!erros.length) {
    const msg = texto(campo(json, "mensagem", "message", "title", "detail"));
    if (msg) erros.push({ codigo: "—", descricao: msg, complemento: null });
  }
  return erros;
}

function json(corpo: string): unknown {
  try {
    return JSON.parse(corpo);
  } catch {
    return null;
  }
}

const cabecalhos = { "Content-Type": "application/json", Accept: "application/json" };

/** Envia a DPS assinada. Rejeição de regra volta como "rejeitada"; falha de conexão ou do serviço lança ErroConexao. */
export async function enviarDps(c: ConexaoSefin, dpsAssinada: string): Promise<ResultadoEmissao> {
  const resp = await requisitar(`${c.base}/nfse`, {
    metodo: "POST",
    credencial: c.credencial,
    corpo: JSON.stringify({ dpsXmlGZipB64: compactar(dpsAssinada) }),
    cabecalhos,
    tempoLimiteMs: 60_000,
    ca: c.ca,
  });
  const r = json(resp.corpo);
  if (resp.status >= 200 && resp.status < 300) {
    const chave = texto(campo(r, "chaveAcesso", "chave"));
    const xmlB64 = texto(campo(r, "nfseXmlGZipB64"));
    if (chave && /^[0-9]{50}$/.test(chave) && xmlB64) return { situacao: "autorizada", chave, xml: descompactar(xmlB64) };
    throw new ErroConexao(`O Emissor Nacional respondeu sem a nota (HTTP ${resp.status}).`, "resposta");
  }
  if (resp.status === 400 || resp.status === 409 || resp.status === 422) {
    const erros = errosDaResposta(r);
    if (erros.length) return { situacao: "rejeitada", erros };
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new ErroConexao(`O Emissor Nacional recusou o certificado da empresa (HTTP ${resp.status}).`, "certificado");
  }
  throw new ErroConexao(`O Emissor Nacional não processou o pedido (HTTP ${resp.status}).`, "servico");
}

/** Chave da NFS-e gerada a partir da DPS, ou null se a DPS ainda não virou nota. */
export async function chaveDaDps(c: ConexaoSefin, idDps: string): Promise<string | null> {
  const resp = await requisitar(`${c.base}/dps/${encodeURIComponent(idDps)}`, { metodo: "GET", credencial: c.credencial, cabecalhos, ca: c.ca });
  if (resp.status === 404) return null;
  if (resp.status >= 200 && resp.status < 300) {
    const chave = texto(campo(json(resp.corpo), "chaveAcesso", "chave"));
    return chave && /^[0-9]{50}$/.test(chave) ? chave : null;
  }
  throw new ErroConexao(`Não foi possível consultar a DPS (HTTP ${resp.status}).`, "servico");
}

/** XML da NFS-e pela chave de acesso. */
export async function nfsePorChave(c: ConexaoSefin, chave: string): Promise<string> {
  const resp = await requisitar(`${c.base}/nfse/${chave}`, { metodo: "GET", credencial: c.credencial, cabecalhos, ca: c.ca });
  const xmlB64 = resp.status >= 200 && resp.status < 300 ? texto(campo(json(resp.corpo), "nfseXmlGZipB64")) : null;
  if (!xmlB64) throw new ErroConexao(`Não foi possível obter a NFS-e (HTTP ${resp.status}).`, "servico");
  return descompactar(xmlB64);
}

/** Registra o pedido de evento (cancelamento). */
export async function registrarEvento(c: ConexaoSefin, chave: string, pedidoAssinado: string): Promise<ResultadoEvento> {
  const resp = await requisitar(`${c.base}/nfse/${chave}/eventos`, {
    metodo: "POST",
    credencial: c.credencial,
    corpo: JSON.stringify({ pedidoRegistroEventoXmlGZipB64: compactar(pedidoAssinado) }),
    cabecalhos,
    tempoLimiteMs: 60_000,
    ca: c.ca,
  });
  const r = json(resp.corpo);
  if (resp.status >= 200 && resp.status < 300) {
    const xmlB64 = texto(campo(r, "eventoXmlGZipB64", "xmlGZipB64"));
    return { situacao: "registrado", xml: xmlB64 ? descompactar(xmlB64) : null };
  }
  if (resp.status === 400 || resp.status === 409 || resp.status === 422) {
    const erros = errosDaResposta(r);
    if (erros.length) return { situacao: "rejeitado", erros };
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new ErroConexao(`O Emissor Nacional recusou o certificado da empresa (HTTP ${resp.status}).`, "certificado");
  }
  throw new ErroConexao(`O Emissor Nacional não processou o cancelamento (HTTP ${resp.status}).`, "servico");
}

// -----------------------------------------------------------------------------
// Leitura da NFS-e (para a tela, o PDF e o registro)
// -----------------------------------------------------------------------------

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, trimValues: true });

export interface NfseLida {
  chave: string | null;
  numero: string | null;
  ambiente: AmbienteNfse | null;
  processadaEm: string | null;
  municipioEmissor: string | null;
  municipioPrestacao: string | null;
  /** Bloco infNFSe e a DPS de origem, como objetos (para o DANFSe) */
  inf: Obj | null;
  dps: Obj | null;
}

export const no = (o: unknown, nome: string): Obj | null => {
  const v = campo(o, nome);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
};
export const val = (o: unknown, ...caminho: string[]): string | null => {
  let atual: unknown = o;
  for (const p of caminho) atual = campo(atual, p);
  return typeof atual === "string" ? atual : typeof atual === "number" ? String(atual) : atual && typeof atual === "object" ? texto(campo(atual, "#text")) : null;
};

export function lerNfse(xml: string): NfseLida {
  const raiz = no(parser.parse(xml), "NFSe");
  const inf = no(raiz, "infNFSe");
  const id = typeof campo(inf, "@Id") === "string" ? (campo(inf, "@Id") as string) : null;
  const dps = no(no(inf, "DPS"), "infDPS");
  // ambGer é o ambiente gerador (prefeitura ou Sefin); produção ou teste vem do tpAmb da DPS
  const tpAmb = val(dps, "tpAmb");
  return {
    chave: id && /^NFS[0-9]{50}$/.test(id) ? id.slice(3) : null,
    numero: val(inf, "nNFSe"),
    ambiente: tpAmb === "1" ? "producao" : tpAmb === "2" ? "homologacao" : null,
    processadaEm: val(inf, "dhProc"),
    municipioEmissor: val(inf, "xLocEmi"),
    municipioPrestacao: val(inf, "xLocPrestacao"),
    inf,
    dps,
  };
}
