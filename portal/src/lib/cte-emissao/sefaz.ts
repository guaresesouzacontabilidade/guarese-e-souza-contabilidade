import { gzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { requisitar, ErroConexao, type Credencial } from "@/lib/notas-automaticas/transporte";
import { CODIGO_UF } from "@/lib/notas-automaticas/nfe";
import type { AmbienteCte } from "./calculo";

/**
 * Serviços do CT-e 4.00 no autorizador do estado do emitente (SOAP 1.2, com o
 * certificado A1 da empresa na conexão), conforme a relação de serviços web
 * do Portal Nacional do CT-e (produção e homologação):
 *  - CTeRecepcaoSincV4: um CT-e por vez, resposta imediata; o XML vai
 *    compactado (GZip) e codificado em Base64 dentro do cteDadosMsg;
 *  - CTeConsultaV4: situação do CT-e pela chave (para não emitir duas vezes
 *    quando uma tentativa ficou sem resposta);
 *  - CTeStatusServicoV4: se o autorizador está no ar;
 *  - CTeRecepcaoEventoV4: cancelamento (110111) e carta de correção (110110),
 *    um evento por vez, sem lote.
 * MT, MS, MG, PR, RS e SP têm autorizador próprio; AP, PE e RR usam a SVSP;
 * os demais estados (inclusive TO), a SVRS.
 */

export const NS_CTE = "http://www.portalfiscal.inf.br/cte";
export const VERSAO_CTE = "4.00";

export type ServicoCte = "recepcao" | "consulta" | "status" | "evento";

const SERVICOS: Record<ServicoCte, { wsdl: string; acao: string }> = {
  recepcao: { wsdl: "CTeRecepcaoSincV4", acao: "cteRecepcao" },
  consulta: { wsdl: "CTeConsultaV4", acao: "cteConsultaCT" },
  status: { wsdl: "CTeStatusServicoV4", acao: "cteStatusServicoCT" },
  evento: { wsdl: "CTeRecepcaoEventoV4", acao: "cteRecepcaoEvento" },
};

interface Autorizador {
  nome: string;
  producao: string;
  homologacao: string;
  /** Endereço do serviço a partir do nome do WSDL */
  caminho: (wsdl: string) => string;
  qrCode: { producao: string; homologacao: string };
}

const mesmoQr = (url: string) => ({ producao: url, homologacao: url });
const SVRS: Omit<Autorizador, "nome"> = {
  producao: "cte.svrs.rs.gov.br",
  homologacao: "cte-homologacao.svrs.rs.gov.br",
  caminho: (s) => `/ws/${s}/${s}.asmx`,
  qrCode: mesmoQr("https://dfe-portal.svrs.rs.gov.br/cte/qrCode"),
};
const SP: Omit<Autorizador, "nome"> = {
  producao: "nfe.fazenda.sp.gov.br",
  homologacao: "homologacao.nfe.fazenda.sp.gov.br",
  caminho: (s) => `/CTeWS/WS/${s}.asmx`,
  qrCode: { producao: "https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode", homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/CTeConsulta/qrCode" },
};

/** Autorizadores do CT-e: servidor de produção, de homologação, caminho dos serviços e endereço do QR Code. */
export const AUTORIZADORES_CTE: Record<string, Autorizador> = {
  MG: {
    nome: "SEFAZ-MG",
    producao: "cte.fazenda.mg.gov.br",
    homologacao: "hcte.fazenda.mg.gov.br",
    caminho: (s) => `/cte/services/${s}`,
    qrCode: mesmoQr("https://portalcte.fazenda.mg.gov.br/portalcte/sistema/qrcode.xhtml"),
  },
  MS: { nome: "SEFAZ-MS", producao: "producao.cte.ms.gov.br", homologacao: "homologacao.cte.ms.gov.br", caminho: (s) => `/ws/${s}`, qrCode: mesmoQr("http://www.dfe.ms.gov.br/cte/qrcode") },
  MT: {
    nome: "SEFAZ-MT",
    producao: "cte.sefaz.mt.gov.br",
    homologacao: "homologacao.sefaz.mt.gov.br",
    caminho: (s) => `/ctews2/services/${s}`,
    qrCode: { producao: "https://www.sefaz.mt.gov.br/cte/qrcode", homologacao: "https://homologacao.sefaz.mt.gov.br/cte/qrcode" },
  },
  PR: {
    nome: "SEFA-PR",
    producao: "cte.fazenda.pr.gov.br",
    homologacao: "homologacao.cte.fazenda.pr.gov.br",
    caminho: (s) => `/cte4/${s}`,
    qrCode: mesmoQr("http://www.fazenda.pr.gov.br/cte/qrcode"),
  },
  RS: { nome: "SEFAZ-RS", ...SVRS },
  SP: { nome: "SEFAZ-SP", ...SP },
  SVRS: { nome: "SEFAZ Virtual do RS (SVRS)", ...SVRS },
  SVSP: { nome: "SEFAZ Virtual de SP (SVSP)", ...SP },
};

const PROPRIOS = new Set(["MG", "MS", "MT", "PR", "RS", "SP"]);
const USAM_SVSP = new Set(["AP", "PE", "RR"]);

export function autorizadorCteDaUf(uf: string): string {
  const u = uf.toUpperCase();
  if (!CODIGO_UF[u]) throw new Error(`UF inválida (${uf}).`);
  if (PROPRIOS.has(u)) return u;
  return USAM_SVSP.has(u) ? "SVSP" : "SVRS";
}

export function urlServicoCte(uf: string, ambiente: AmbienteCte, servico: ServicoCte): string {
  const a = AUTORIZADORES_CTE[autorizadorCteDaUf(uf)];
  return `https://${a[ambiente]}${a.caminho(SERVICOS[servico].wsdl)}`;
}

/** Endereço da consulta pública pelo QR Code (sem a chave), do autorizador do emitente. */
export function urlQrCode(uf: string, ambiente: AmbienteCte): string {
  return AUTORIZADORES_CTE[autorizadorCteDaUf(uf)].qrCode[ambiente];
}

export interface ConexaoSefazCte {
  uf: string;
  ambiente: AmbienteCte;
  credencial: Credencial;
  /** Só nos testes automáticos: servidor local no lugar do autorizador */
  base?: string;
  ca?: string[];
}

function envelope(servico: ServicoCte, corpo: string) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/${SERVICOS[servico].wsdl}">${corpo}</cteDadosMsg></soap12:Body></soap12:Envelope>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => ["protCTe", "procEventoCTe"].includes(nome),
});

type No = Record<string, unknown>;

function lerXml(xml: string): No {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Resposta com DOCTYPE/ENTITY recusada.");
  return parser.parse(xml) as No;
}

function achar(no: unknown, nome: string): No | null {
  if (!no || typeof no !== "object") return null;
  if (Array.isArray(no)) {
    for (const x of no) {
      const r = achar(x, nome);
      if (r) return r;
    }
    return null;
  }
  const o = no as No;
  if (nome in o) {
    const v = o[nome];
    return (Array.isArray(v) ? v[0] : v) as No;
  }
  for (const v of Object.values(o)) {
    const r = achar(v, nome);
    if (r) return r;
  }
  return null;
}

function texto(no: No | null | undefined, campo: string): string | null {
  const v = no?.[campo];
  if (v == null) return null;
  if (typeof v === "object") return String((v as No)["#text"] ?? "") || null;
  return String(v);
}

/** Trechos XML brutos (protCTe, retEventoCTe, procEventoCTe) da resposta, sem prefixo nem o namespace padrão do CT-e. */
export function trechosCte(xml: string, nome: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${nome}\\b[\\s\\S]*?</(?:\\w+:)?${nome}>`, "g");
  return [...xml.matchAll(re)].map((m) => {
    let t = m[0].replace(new RegExp(`^<\\w+:${nome}\\b`), `<${nome}`).replace(new RegExp(`</\\w+:${nome}>$`), `</${nome}>`);
    // Dentro do cteProc/procEventoCTe o namespace padrão já é o do CT-e
    t = t.replace(new RegExp(`^<${nome}([^>]*?)\\s+xmlns="${NS_CTE.replace(/[.]/g, "\\.")}"`), `<${nome}$1`);
    return t;
  });
}

async function chamar(c: ConexaoSefazCte, servico: ServicoCte, corpo: string, tempoLimiteMs = 60_000): Promise<string> {
  const url = c.base ? `${c.base}/${servico}` : urlServicoCte(c.uf, c.ambiente, servico);
  const { wsdl, acao } = SERVICOS[servico];
  const r = await requisitar(url, {
    metodo: "POST",
    credencial: c.credencial,
    corpo: envelope(servico, corpo),
    cabecalhos: { "Content-Type": `application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/cte/wsdl/${wsdl}/${acao}"` },
    tempoLimiteMs,
    ca: c.ca,
    icpBrasil: !c.base,
  });
  if (r.status === 403 || r.status === 495 || r.status === 496) {
    throw new ErroConexao("O autorizador recusou o certificado digital da empresa (confira se o certificado é o da empresa e está válido).", "certificado");
  }
  if (r.status >= 500 && !/<(\w+:)?ret\w+/.test(r.corpo)) {
    const motivo = /<(?:\w+:)?(?:Text|faultstring)[^>]*>([^<]{1,300})</.exec(r.corpo)?.[1];
    throw new ErroConexao(`O autorizador respondeu com erro (HTTP ${r.status})${motivo ? `: ${motivo}` : ""}.`, `http_${r.status}`);
  }
  if (r.status !== 200 && !/<(\w+:)?ret\w+/.test(r.corpo)) throw new ErroConexao(`Resposta inesperada do autorizador (HTTP ${r.status}).`, `http_${r.status}`);
  return r.corpo;
}

// -----------------------------------------------------------------------------
// Autorização
// -----------------------------------------------------------------------------

export interface ProtocoloCte {
  chave: string;
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
  recebidaEm: string | null;
  /** protCTe bruto, para o cteProc */
  xml: string | null;
}

/** 100 autorizado; 150 autorizado fora do prazo. */
export const CTE_AUTORIZADO = new Set(["100", "150"]);
/** Uso denegado (irregularidade do emitente ou do tomador): o número fica usado. */
export const CTE_DENEGADO = new Set(["110", "205", "301", "302", "303"]);
/** Duplicidade: o CT-e (ou outro com o mesmo número) já existe no autorizador. */
export const CTE_DUPLICIDADE = new Set(["204", "539"]);

function lerProtocolos(resposta: string): ProtocoloCte[] {
  return trechosCte(resposta, "protCTe").map((x) => {
    const inf = achar(lerXml(x), "infProt");
    return {
      chave: texto(inf, "chCTe") ?? "",
      cStat: texto(inf, "cStat") ?? "",
      xMotivo: texto(inf, "xMotivo") ?? "",
      protocolo: texto(inf, "nProt"),
      recebidaEm: texto(inf, "dhRecbto"),
      xml: x,
    };
  });
}

export type ResultadoRecepcaoCte = { tipo: "protocolo"; protocolo: ProtocoloCte } | { tipo: "rejeitado"; cStat: string; xMotivo: string };

export function lerRetornoRecepcao(resposta: string, chave: string): ResultadoRecepcaoCte {
  const ret = achar(lerXml(resposta), "retCTe");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno do CT-e (retCTe).");
  const p = lerProtocolos(resposta).find((x) => x.chave === chave) ?? lerProtocolos(resposta)[0];
  if (p) return { tipo: "protocolo", protocolo: p };
  // Sem protCTe: recusado antes do processamento (esquema, certificado, assinatura etc.)
  return { tipo: "rejeitado", cStat: texto(ret, "cStat") ?? "", xMotivo: texto(ret, "xMotivo") ?? "" };
}

/** XML compactado (GZip) e em Base64, como pede a recepção síncrona. */
export function compactarCte(xml: string): string {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export async function enviarCte(c: ConexaoSefazCte, cteXml: string, chave: string): Promise<ResultadoRecepcaoCte> {
  return lerRetornoRecepcao(await chamar(c, "recepcao", compactarCte(cteXml), 90_000), chave);
}

export interface SituacaoCte {
  cStat: string;
  xMotivo: string;
  protocolo: ProtocoloCte | null;
  /** procEventoCTe brutos (cancelamento, carta de correção) */
  eventos: string[];
}

/** Situação do CT-e pela chave: 100/150 autorizado; 101 cancelado; 110/301/302 denegado; 217 não consta. */
export async function consultarCte(c: ConexaoSefazCte, chave: string): Promise<SituacaoCte> {
  const corpo = `<consSitCTe xmlns="${NS_CTE}" versao="${VERSAO_CTE}"><tpAmb>${c.ambiente === "producao" ? 1 : 2}</tpAmb><xServ>CONSULTAR</xServ><chCTe>${chave}</chCTe></consSitCTe>`;
  const resposta = await chamar(c, "consulta", corpo);
  const ret = achar(lerXml(resposta), "retConsSitCTe");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno da consulta (retConsSitCTe).");
  return {
    cStat: texto(ret, "cStat") ?? "",
    xMotivo: texto(ret, "xMotivo") ?? "",
    protocolo: lerProtocolos(resposta).find((p) => p.chave === chave) ?? null,
    eventos: trechosCte(resposta, "procEventoCTe"),
  };
}

export async function statusServicoCte(c: ConexaoSefazCte): Promise<{ cStat: string; xMotivo: string; tempoMedio: string | null }> {
  const cuf = CODIGO_UF[c.uf.toUpperCase()];
  const corpo = `<consStatServCTe xmlns="${NS_CTE}" versao="${VERSAO_CTE}"><tpAmb>${c.ambiente === "producao" ? 1 : 2}</tpAmb><cUF>${cuf}</cUF><xServ>STATUS</xServ></consStatServCTe>`;
  const ret = achar(lerXml(await chamar(c, "status", corpo, 30_000)), "retConsStatServCTe");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno do status (retConsStatServCTe).");
  return { cStat: texto(ret, "cStat") ?? "", xMotivo: texto(ret, "xMotivo") ?? "", tempoMedio: texto(ret, "tMed") };
}

/** CT-e com o protocolo de autorização (o arquivo que vale como documento fiscal). */
export function montarCteProc(cteXml: string, protCTe: string): string {
  const cte = cteXml.replace(new RegExp(`^<CTe xmlns="${NS_CTE.replace(/[.]/g, "\\.")}"`), "<CTe");
  return `<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="${NS_CTE}" versao="${VERSAO_CTE}">${cte}${protCTe}</cteProc>`;
}

// -----------------------------------------------------------------------------
// Eventos
// -----------------------------------------------------------------------------

export interface RetornoEventoCte {
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
  registradoEm: string | null;
  /** retEventoCTe bruto */
  xml: string | null;
}

/** 134 registrado com alerta; 135 registrado e vinculado; 136 registrado sem vínculo. */
export const EVENTO_CTE_ACEITO = new Set(["134", "135", "136"]);

export function lerRetornoEvento(resposta: string): RetornoEventoCte {
  const bruto = trechosCte(resposta, "retEventoCTe")[0] ?? null;
  const inf = bruto ? achar(lerXml(bruto), "infEvento") : null;
  if (!inf) throw new Error("Resposta do autorizador sem o retorno do evento (retEventoCTe).");
  return {
    cStat: texto(inf, "cStat") ?? "",
    xMotivo: texto(inf, "xMotivo") ?? "",
    protocolo: texto(inf, "nProt"),
    registradoEm: texto(inf, "dhRegEvento"),
    xml: bruto,
  };
}

export async function enviarEventoCte(c: ConexaoSefazCte, eventoXml: string): Promise<RetornoEventoCte> {
  return lerRetornoEvento(await chamar(c, "evento", eventoXml));
}

/** O evento já registrado (tipo e sequência) entre os procEventoCTe da consulta, com o retorno da SEFAZ. */
export function eventoRegistrado(eventos: string[], tipo: string, sequencia: number): { proc: string; retorno: RetornoEventoCte } | null {
  for (const proc of eventos) {
    const ret = trechosCte(proc, "retEventoCTe")[0];
    const inf = ret ? achar(lerXml(ret), "infEvento") : null;
    if (texto(inf, "tpEvento") !== tipo || Number(texto(inf, "nSeqEvento")) !== sequencia) continue;
    const r = lerRetornoEvento(ret);
    if (EVENTO_CTE_ACEITO.has(r.cStat)) return { proc: proc.startsWith("<?xml") ? proc : `<?xml version="1.0" encoding="UTF-8"?>${comNamespace(proc)}`, retorno: r };
  }
  return null;
}

function comNamespace(proc: string) {
  return /^<procEventoCTe[^>]*xmlns=/.test(proc) ? proc : proc.replace(/^<procEventoCTe/, `<procEventoCTe xmlns="${NS_CTE}"`);
}

export function montarProcEventoCte(eventoXml: string, retEvento: string): string {
  const ev = eventoXml.replace(new RegExp(`^<eventoCTe xmlns="${NS_CTE.replace(/[.]/g, "\\.")}"`), "<eventoCTe");
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoCTe xmlns="${NS_CTE}" versao="${VERSAO_CTE}">${ev}${retEvento}</procEventoCTe>`;
}
