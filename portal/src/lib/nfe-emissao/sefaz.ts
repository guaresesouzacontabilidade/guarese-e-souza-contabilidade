import { XMLParser } from "fast-xml-parser";
import { requisitar, ErroConexao, type Credencial } from "@/lib/notas-automaticas/transporte";
import { CODIGO_UF } from "@/lib/notas-automaticas/nfe";
import type { AmbienteNfe } from "./calculo";
import { NS_NFE, VERSAO_NFE } from "./nfe";

/**
 * Serviços da NF-e 4.00 no autorizador do estado do emitente (SOAP 1.2, com o
 * certificado A1 da empresa na conexão), conforme a relação de serviços web
 * do Portal Nacional da NF-e (produção e homologação, conferida em 20/10/2026):
 *  - NFeAutorizacao4: lote com uma nota, modo síncrono (indSinc = 1); se o
 *    autorizador responder "lote recebido" (103), o recibo é consultado em
 *    NFeRetAutorizacao4;
 *  - NFeConsultaProtocolo4: situação da nota pela chave (para não emitir duas
 *    vezes quando uma tentativa ficou sem resposta);
 *  - NFeStatusServico4: se o autorizador está no ar;
 *  - NFeRecepcaoEvento4: cancelamento (110111) e carta de correção (110110).
 * MT, GO, MS, MG, PR, PE, BA, AM, SP e RS têm autorizador próprio; MA usa a
 * SVAN; os demais estados (inclusive TO), a SVRS.
 */

export type ServicoNfe = "autorizacao" | "retAutorizacao" | "consulta" | "status" | "evento";

const SERVICOS: Record<ServicoNfe, { wsdl: string; acao: string }> = {
  autorizacao: { wsdl: "NFeAutorizacao4", acao: "nfeAutorizacaoLote" },
  retAutorizacao: { wsdl: "NFeRetAutorizacao4", acao: "nfeRetAutorizacaoLote" },
  consulta: { wsdl: "NFeConsultaProtocolo4", acao: "nfeConsultaNF" },
  status: { wsdl: "NFeStatusServico4", acao: "nfeStatusServicoNF" },
  evento: { wsdl: "NFeRecepcaoEvento4", acao: "nfeRecepcaoEvento" },
};

type Caminhos = Record<ServicoNfe, string>;

const ASMX_BA: Caminhos = {
  autorizacao: "/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx",
  retAutorizacao: "/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
  consulta: "/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
  status: "/webservices/NFeStatusServico4/NFeStatusServico4.asmx",
  evento: "/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
};
const RS: Caminhos = {
  autorizacao: "/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
  retAutorizacao: "/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
  consulta: "/ws/NfeConsulta/NfeConsulta4.asmx",
  status: "/ws/NfeStatusServico/NfeStatusServico4.asmx",
  evento: "/ws/recepcaoevento/recepcaoevento4.asmx",
};
const prefixado = (prefixo: string, nomes: Caminhos): Caminhos =>
  Object.fromEntries(Object.entries(nomes).map(([k, v]) => [k, `${prefixo}${v}`])) as Caminhos;
const NOMES_PADRAO: Caminhos = {
  autorizacao: "NFeAutorizacao4",
  retAutorizacao: "NFeRetAutorizacao4",
  consulta: "NFeConsultaProtocolo4",
  status: "NFeStatusServico4",
  evento: "NFeRecepcaoEvento4",
};

/** Autorizadores: servidor de produção, de homologação e caminhos dos serviços. */
export const AUTORIZADORES: Record<string, { nome: string; producao: string; homologacao: string; caminhos: Caminhos }> = {
  AM: {
    nome: "SEFAZ-AM",
    producao: "nfe.sefaz.am.gov.br",
    homologacao: "homnfe.sefaz.am.gov.br",
    caminhos: prefixado("/services2/services/", { ...NOMES_PADRAO, autorizacao: "NfeAutorizacao4", retAutorizacao: "NfeRetAutorizacao4", consulta: "NfeConsulta4", status: "NfeStatusServico4", evento: "RecepcaoEvento4" }),
  },
  BA: { nome: "SEFAZ-BA", producao: "nfe.sefaz.ba.gov.br", homologacao: "hnfe.sefaz.ba.gov.br", caminhos: ASMX_BA },
  GO: { nome: "SEFAZ-GO", producao: "nfe.sefaz.go.gov.br", homologacao: "homolog.sefaz.go.gov.br", caminhos: prefixado("/nfe/services/", NOMES_PADRAO) },
  MG: { nome: "SEFAZ-MG", producao: "nfe.fazenda.mg.gov.br", homologacao: "hnfe.fazenda.mg.gov.br", caminhos: prefixado("/nfe2/services/", NOMES_PADRAO) },
  MS: { nome: "SEFAZ-MS", producao: "nfe.sefaz.ms.gov.br", homologacao: "hom.nfe.sefaz.ms.gov.br", caminhos: prefixado("/ws/", NOMES_PADRAO) },
  MT: {
    nome: "SEFAZ-MT",
    producao: "nfe.sefaz.mt.gov.br",
    homologacao: "homologacao.sefaz.mt.gov.br",
    caminhos: prefixado("/nfews/v2/services/", { autorizacao: "NfeAutorizacao4", retAutorizacao: "NfeRetAutorizacao4", consulta: "NfeConsulta4", status: "NfeStatusServico4", evento: "RecepcaoEvento4" }),
  },
  PE: { nome: "SEFAZ-PE", producao: "nfe.sefaz.pe.gov.br", homologacao: "nfehomolog.sefaz.pe.gov.br", caminhos: prefixado("/nfe-service/services/", NOMES_PADRAO) },
  PR: { nome: "SEFA-PR", producao: "nfe.sefa.pr.gov.br", homologacao: "homologacao.nfe.sefa.pr.gov.br", caminhos: prefixado("/nfe/", NOMES_PADRAO) },
  RS: { nome: "SEFAZ-RS", producao: "nfe.sefazrs.rs.gov.br", homologacao: "nfe-homologacao.sefazrs.rs.gov.br", caminhos: RS },
  SP: {
    nome: "SEFAZ-SP",
    producao: "nfe.fazenda.sp.gov.br",
    homologacao: "homologacao.nfe.fazenda.sp.gov.br",
    caminhos: prefixado("/ws/", { autorizacao: "nfeautorizacao4.asmx", retAutorizacao: "nferetautorizacao4.asmx", consulta: "nfeconsultaprotocolo4.asmx", status: "nfestatusservico4.asmx", evento: "nferecepcaoevento4.asmx" }),
  },
  SVAN: {
    nome: "SEFAZ Virtual do Ambiente Nacional (SVAN)",
    producao: "www.sefazvirtual.fazenda.gov.br",
    homologacao: "hom.sefazvirtual.fazenda.gov.br",
    caminhos: Object.fromEntries(Object.entries(NOMES_PADRAO).map(([k, v]) => [k, `/${v}/${v}.asmx`])) as Caminhos,
  },
  SVRS: { nome: "SEFAZ Virtual do RS (SVRS)", producao: "nfe.svrs.rs.gov.br", homologacao: "nfe-homologacao.svrs.rs.gov.br", caminhos: RS },
};

const PROPRIOS = new Set(["AM", "BA", "GO", "MG", "MS", "MT", "PE", "PR", "RS", "SP"]);

export function autorizadorDaUf(uf: string): string {
  const u = uf.toUpperCase();
  if (!CODIGO_UF[u]) throw new Error(`UF inválida (${uf}).`);
  if (PROPRIOS.has(u)) return u;
  return u === "MA" ? "SVAN" : "SVRS";
}

export function urlServico(uf: string, ambiente: AmbienteNfe, servico: ServicoNfe): string {
  const a = AUTORIZADORES[autorizadorDaUf(uf)];
  return `https://${a[ambiente]}${a.caminhos[servico]}`;
}

export interface ConexaoSefaz {
  uf: string;
  ambiente: AmbienteNfe;
  credencial: Credencial;
  /** Só nos testes automáticos: servidor local no lugar do autorizador */
  base?: string;
  ca?: string[];
}

function envelope(servico: ServicoNfe, corpo: string) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${SERVICOS[servico].wsdl}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => ["protNFe", "retEvento", "procEventoNFe"].includes(nome),
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

/** Trechos XML brutos (protNFe, retEvento) da resposta, sem prefixo de namespace, para montar os "proc". */
export function trechos(xml: string, nome: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${nome}\\b[\\s\\S]*?</(?:\\w+:)?${nome}>`, "g");
  return [...xml.matchAll(re)].map((m) => {
    let t = m[0].replace(new RegExp(`^<\\w+:${nome}\\b`), `<${nome}`).replace(new RegExp(`</\\w+:${nome}>$`), `</${nome}>`);
    // Dentro do nfeProc o namespace padrão já é o da NF-e
    t = t.replace(new RegExp(`^<${nome}([^>]*?)\\s+xmlns="${NS_NFE.replace(/[.]/g, "\\.")}"`), `<${nome}$1`);
    return t;
  });
}

async function chamar(c: ConexaoSefaz, servico: ServicoNfe, corpo: string, tempoLimiteMs = 60_000): Promise<string> {
  const url = c.base ? `${c.base}/${servico}` : urlServico(c.uf, c.ambiente, servico);
  const r = await requisitar(url, {
    metodo: "POST",
    credencial: c.credencial,
    corpo: envelope(servico, corpo),
    cabecalhos: {
      "Content-Type": `application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/${SERVICOS[servico].wsdl}/${SERVICOS[servico].acao}"`,
    },
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

export interface Protocolo {
  chave: string;
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
  recebidaEm: string | null;
  /** protNFe bruto, para o nfeProc */
  xml: string | null;
}

export type ResultadoAutorizacao =
  | { tipo: "protocolo"; protocolo: Protocolo }
  | { tipo: "recibo"; recibo: string; tempoMedio: number }
  | { tipo: "lote_rejeitado"; cStat: string; xMotivo: string };

/** 100 autorizada; 150 autorizada fora do prazo. */
export const AUTORIZADA = new Set(["100", "150"]);
/** Uso denegado (irregularidade do emitente ou do destinatário): o número fica usado. */
export const DENEGADA = new Set(["110", "205", "301", "302", "303"]);
/** Duplicidade: a nota (ou outra com o mesmo número) já existe no autorizador. */
export const DUPLICIDADE = new Set(["204", "539"]);

function lerProtocolos(resposta: string): Protocolo[] {
  return trechos(resposta, "protNFe").map((x) => {
    const inf = achar(lerXml(x), "infProt");
    return {
      chave: texto(inf, "chNFe") ?? "",
      cStat: texto(inf, "cStat") ?? "",
      xMotivo: texto(inf, "xMotivo") ?? "",
      protocolo: texto(inf, "nProt"),
      recebidaEm: texto(inf, "dhRecbto"),
      xml: x,
    };
  });
}

export function lerRetornoAutorizacao(resposta: string, chave: string): ResultadoAutorizacao {
  const ret = achar(lerXml(resposta), "retEnviNFe");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno do lote (retEnviNFe).");
  const cStat = texto(ret, "cStat") ?? "";
  const xMotivo = texto(ret, "xMotivo") ?? "";
  if (cStat === "103") {
    const rec = achar(ret, "infRec");
    const recibo = texto(rec, "nRec");
    if (!recibo) throw new Error("Lote recebido sem número de recibo.");
    return { tipo: "recibo", recibo, tempoMedio: Number(texto(rec, "tMed") ?? "1") || 1 };
  }
  if (cStat === "104") {
    const p = lerProtocolos(resposta).find((x) => x.chave === chave) ?? lerProtocolos(resposta)[0];
    if (!p) throw new Error("Lote processado sem o protocolo da nota.");
    return { tipo: "protocolo", protocolo: p };
  }
  return { tipo: "lote_rejeitado", cStat, xMotivo };
}

export async function enviarLote(c: ConexaoSefaz, nfeXml: string, chave: string, idLote: string): Promise<ResultadoAutorizacao> {
  const corpo = `<enviNFe xmlns="${NS_NFE}" versao="${VERSAO_NFE}"><idLote>${idLote.replace(/\D/g, "").slice(0, 15) || "1"}</idLote><indSinc>1</indSinc>${nfeXml}</enviNFe>`;
  return lerRetornoAutorizacao(await chamar(c, "autorizacao", corpo, 90_000), chave);
}

export type ResultadoRecibo = { tipo: "protocolo"; protocolo: Protocolo } | { tipo: "processando" } | { tipo: "erro"; cStat: string; xMotivo: string };

export async function consultarRecibo(c: ConexaoSefaz, recibo: string, chave: string): Promise<ResultadoRecibo> {
  const corpo = `<consReciNFe xmlns="${NS_NFE}" versao="${VERSAO_NFE}"><tpAmb>${c.ambiente === "producao" ? 1 : 2}</tpAmb><nRec>${recibo}</nRec></consReciNFe>`;
  const resposta = await chamar(c, "retAutorizacao", corpo);
  const ret = achar(lerXml(resposta), "retConsReciNFe");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno do recibo (retConsReciNFe).");
  const cStat = texto(ret, "cStat") ?? "";
  if (cStat === "105") return { tipo: "processando" };
  if (cStat === "104") {
    const p = lerProtocolos(resposta).find((x) => x.chave === chave);
    if (p) return { tipo: "protocolo", protocolo: p };
  }
  return { tipo: "erro", cStat, xMotivo: texto(ret, "xMotivo") ?? "" };
}

export interface SituacaoNota {
  cStat: string;
  xMotivo: string;
  protocolo: Protocolo | null;
  /** procEventoNFe brutos (cancelamento, carta de correção) */
  eventos: string[];
}

/** Situação da nota pela chave: 100/150 autorizada; 101/151 cancelada; 110/301/302 denegada; 217 não consta. */
export async function consultarNota(c: ConexaoSefaz, chave: string): Promise<SituacaoNota> {
  const corpo = `<consSitNFe xmlns="${NS_NFE}" versao="${VERSAO_NFE}"><tpAmb>${c.ambiente === "producao" ? 1 : 2}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
  const resposta = await chamar(c, "consulta", corpo);
  const ret = achar(lerXml(resposta), "retConsSitNFe");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno da consulta (retConsSitNFe).");
  return {
    cStat: texto(ret, "cStat") ?? "",
    xMotivo: texto(ret, "xMotivo") ?? "",
    protocolo: lerProtocolos(resposta).find((p) => p.chave === chave) ?? null,
    eventos: trechos(resposta, "procEventoNFe"),
  };
}

export async function statusServico(c: ConexaoSefaz): Promise<{ cStat: string; xMotivo: string; tempoMedio: string | null }> {
  const cuf = CODIGO_UF[c.uf.toUpperCase()];
  const corpo = `<consStatServ xmlns="${NS_NFE}" versao="${VERSAO_NFE}"><tpAmb>${c.ambiente === "producao" ? 1 : 2}</tpAmb><cUF>${cuf}</cUF><xServ>STATUS</xServ></consStatServ>`;
  const ret = achar(lerXml(await chamar(c, "status", corpo, 30_000)), "retConsStatServ");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno do status (retConsStatServ).");
  return { cStat: texto(ret, "cStat") ?? "", xMotivo: texto(ret, "xMotivo") ?? "", tempoMedio: texto(ret, "tMed") };
}

/** Nota com o protocolo de autorização (o arquivo que vale como documento fiscal). */
export function montarNfeProc(nfeXml: string, protNFe: string): string {
  const nfe = nfeXml.replace(new RegExp(`^<NFe xmlns="${NS_NFE.replace(/[.]/g, "\\.")}"`), "<NFe");
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS_NFE}" versao="${VERSAO_NFE}">${nfe}${protNFe}</nfeProc>`;
}

// -----------------------------------------------------------------------------
// Eventos
// -----------------------------------------------------------------------------

export interface RetornoEventoNfe {
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
  registradoEm: string | null;
  /** retEvento bruto */
  xml: string | null;
}

/** 135 registrado e vinculado; 136 registrado sem vínculo; 155 cancelamento fora do prazo homologado; 573 já registrado. */
export const EVENTO_ACEITO = new Set(["135", "136", "155"]);

export async function enviarEvento(c: ConexaoSefaz, eventoXml: string, idLote: string): Promise<RetornoEventoNfe> {
  const corpo = `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${idLote.replace(/\D/g, "").slice(0, 15) || "1"}</idLote>${eventoXml}</envEvento>`;
  const resposta = await chamar(c, "evento", corpo);
  const ret = achar(lerXml(resposta), "retEnvEvento");
  if (!ret) throw new Error("Resposta do autorizador sem o retorno do evento (retEnvEvento).");
  const loteStat = texto(ret, "cStat") ?? "";
  const bruto = trechos(resposta, "retEvento")[0] ?? null;
  if (loteStat !== "128" || !bruto) return { cStat: loteStat, xMotivo: texto(ret, "xMotivo") ?? "", protocolo: null, registradoEm: null, xml: null };
  const inf = achar(lerXml(bruto), "infEvento");
  return {
    cStat: texto(inf, "cStat") ?? "",
    xMotivo: texto(inf, "xMotivo") ?? "",
    protocolo: texto(inf, "nProt"),
    registradoEm: texto(inf, "dhRegEvento"),
    xml: bruto,
  };
}

export function montarProcEvento(eventoXml: string, retEvento: string): string {
  const ev = eventoXml.replace(new RegExp(`^<evento xmlns="${NS_NFE.replace(/[.]/g, "\\.")}"`), "<evento");
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS_NFE}" versao="1.00">${ev}${retEvento}</procEventoNFe>`;
}
