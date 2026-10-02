import { createHash, createPrivateKey, sign, X509Certificate } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

/**
 * NF-e no Ambiente Nacional (SEFAZ):
 *  - Distribuição de DF-e (NT 2014.002): documentos de interesse da empresa por
 *    NSU (resumos, XML completos e eventos);
 *  - Recepção de evento: "Ciência da emissão" (210210), que libera o XML
 *    completo da nota ao destinatário sem confirmar nem recusar a operação.
 * Endereços conferidos em 02/10/2026: os serviços respondem e exigem o
 * certificado da empresa na conexão.
 */

export type Ambiente = "producao" | "homologacao";

export const URLS_NFE = {
  distribuicao: {
    producao: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    homologacao: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  },
  evento: {
    producao: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
    homologacao: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  },
} as const;

export const ACAO_DISTRIBUICAO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
export const ACAO_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";

/** Código IBGE da UF (cUFAutor). */
export const CODIGO_UF: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25",
  PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50",
  MT: "51", GO: "52", DF: "53",
};

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => ["docZip", "retEvento"].includes(nome),
});

type No = Record<string, unknown>;

function lerXml(xml: string): No {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Resposta com DOCTYPE/ENTITY recusada.");
  return parser.parse(xml) as No;
}

/** Procura um elemento em qualquer nível (o envelope SOAP varia). */
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
  if (nome in o) return o[nome] as No;
  for (const v of Object.values(o)) {
    const r = achar(v, nome);
    if (r) return r;
  }
  return null;
}

const texto = (no: No | null | undefined, campo: string): string | null => {
  const v = no?.[campo];
  if (v == null) return null;
  if (typeof v === "object") return String((v as No)["#text"] ?? "") || null;
  return String(v);
};

function escapar(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function envelope(corpo: string) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`
  );
}

export function tipoConteudoSoap(acao: string) {
  return `application/soap+xml; charset=utf-8; action="${acao}"`;
}

// -----------------------------------------------------------------------------
// Distribuição de DF-e
// -----------------------------------------------------------------------------
export function montarDistribuicao(p: { cnpj: string; uf: string; ultNsu: string; ambiente: Ambiente }) {
  const cuf = CODIGO_UF[p.uf.toUpperCase()];
  if (!cuf) throw new Error(`UF da empresa inválida (${p.uf}).`);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(p.cnpj)) throw new Error("CNPJ da empresa inválido.");
  const nsu = p.ultNsu.padStart(15, "0");
  return envelope(
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>' +
      `<distDFeInt xmlns="${NS_NFE}" versao="1.01"><tpAmb>${p.ambiente === "producao" ? 1 : 2}</tpAmb><cUFAutor>${cuf}</cUFAutor>` +
      `<CNPJ>${p.cnpj}</CNPJ><distNSU><ultNSU>${nsu}</ultNSU></distNSU></distDFeInt>` +
      "</nfeDadosMsg></nfeDistDFeInteresse>",
  );
}

export interface DocumentoDistribuido {
  nsu: string;
  schema: string;
  /** "resNFe" | "procNFe" | "resEvento" | "procEventoNFe" | outro */
  tipo: string;
  xml: string;
}

export interface RetornoDistribuicao {
  cStat: string;
  xMotivo: string;
  ultNsu: string | null;
  maxNsu: string | null;
  documentos: DocumentoDistribuido[];
}

/** 137: nenhum documento; 138: documentos localizados; 656: consumo indevido (aguardar 1 hora). */
export function lerRetornoDistribuicao(xml: string): RetornoDistribuicao {
  const ret = achar(lerXml(xml), "retDistDFeInt");
  if (!ret) throw new Error("Resposta da SEFAZ sem o retorno da distribuição (retDistDFeInt).");
  const lote = achar(ret, "loteDistDFeInt");
  const docs = ((lote?.docZip as No[] | undefined) ?? []).map((d) => {
    const nsu = String(d["@_NSU"] ?? "");
    const schema = String(d["@_schema"] ?? "");
    const conteudo = String(d["#text"] ?? "");
    let xmlDoc: string;
    try {
      xmlDoc = gunzipSync(Buffer.from(conteudo, "base64")).toString("utf8");
    } catch {
      throw new Error(`Documento do NSU ${nsu} com conteúdo compactado inválido.`);
    }
    return { nsu, schema, tipo: schema.split("_")[0] || "desconhecido", xml: xmlDoc };
  });
  return {
    cStat: texto(ret, "cStat") ?? "",
    xMotivo: texto(ret, "xMotivo") ?? "",
    ultNsu: texto(ret, "ultNSU"),
    maxNsu: texto(ret, "maxNSU"),
    documentos: docs,
  };
}

export interface ResumoNfe {
  chave: string;
  emitenteDocumento: string | null;
  emitenteNome: string | null;
  emitenteIe: string | null;
  dataEmissao: string | null;
  /** tpNF da nota, do ponto de vista de quem emitiu (0 = entrada, 1 = saída). */
  tipoNf: "0" | "1" | null;
  valor: string | null;
  protocolo: string | null;
  situacao: "autorizada" | "denegada" | "cancelada";
}

export function lerResumoNfe(xml: string): ResumoNfe | null {
  const r = achar(lerXml(xml), "resNFe");
  const chave = texto(r, "chNFe");
  if (!r || !chave || !/^[0-9]{44}$/.test(chave)) return null;
  const sit = texto(r, "cSitNFe");
  const tp = texto(r, "tpNF");
  return {
    chave,
    emitenteDocumento: texto(r, "CNPJ") ?? texto(r, "CPF"),
    emitenteNome: texto(r, "xNome"),
    emitenteIe: texto(r, "IE"),
    dataEmissao: texto(r, "dhEmi"),
    tipoNf: tp === "0" || tp === "1" ? tp : null,
    valor: texto(r, "vNF"),
    protocolo: texto(r, "nProt"),
    situacao: sit === "2" ? "denegada" : sit === "3" ? "cancelada" : "autorizada",
  };
}

export function lerResumoEvento(xml: string): { chave: string; tipoEvento: string; descricao: string | null } | null {
  const r = achar(lerXml(xml), "resEvento");
  const chave = texto(r, "chNFe");
  const tipo = texto(r, "tpEvento");
  if (!chave || !tipo) return null;
  return { chave, tipoEvento: tipo, descricao: texto(r, "xEvento") };
}

/** Tipo do evento num procEventoNFe (para não importar as manifestações da própria empresa). */
export function tipoEventoDoProc(xml: string): string | null {
  return texto(achar(lerXml(xml), "infEvento"), "tpEvento");
}

// -----------------------------------------------------------------------------
// Ciência da emissão (evento 210210) com assinatura XML (RSA-SHA1, C14N)
// -----------------------------------------------------------------------------

/** Data e hora no fuso de Tocantins (UTC−3, sem horário de verão). */
export function dataHoraBrasil(d: Date): string {
  const t = new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 19);
  return `${t}-03:00`;
}

/**
 * Evento assinado. O XML é gerado já na forma canônica (C14N inclusiva): sem
 * espaços entre elementos e com os namespaces declarados no próprio elemento,
 * de modo que o resumo (digest) calculado aqui é o mesmo que a SEFAZ calcula.
 */
export function eventoCienciaAssinado(p: {
  chave: string;
  cnpj: string;
  ambiente: Ambiente;
  quando: Date;
  chavePem: string;
  certificadoPem: string;
  sequencia?: number;
}): string {
  if (!/^[0-9]{44}$/.test(p.chave)) throw new Error("Chave de acesso inválida.");
  const seq = p.sequencia ?? 1;
  const id = `ID210210${p.chave}${String(seq).padStart(2, "0")}`;
  const filhos =
    `<cOrgao>91</cOrgao><tpAmb>${p.ambiente === "producao" ? 1 : 2}</tpAmb><CNPJ>${escapar(p.cnpj)}</CNPJ><chNFe>${p.chave}</chNFe>` +
    `<dhEvento>${dataHoraBrasil(p.quando)}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>` +
    '<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>';
  const canonico = `<infEvento xmlns="${NS_NFE}" Id="${id}">${filhos}</infEvento>`;
  const digest = createHash("sha1").update(canonico, "utf8").digest("base64");
  const signedInfo =
    `<SignedInfo xmlns="${NS_DSIG}">` +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>' +
    `<Reference URI="#${id}"><Transforms>` +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>' +
    '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform>' +
    "</Transforms>" +
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>' +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const assinatura = sign("sha1", Buffer.from(signedInfo, "utf8"), createPrivateKey(p.chavePem)).toString("base64");
  const certificado = new X509Certificate(p.certificadoPem).raw.toString("base64");
  return (
    `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${id}">${filhos}</infEvento>` +
    `<Signature xmlns="${NS_DSIG}">${signedInfo.replace(` xmlns="${NS_DSIG}"`, "")}<SignatureValue>${assinatura}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificado}</X509Certificate></X509Data></KeyInfo></Signature></evento>`
  );
}

export function montarEnvioEventos(eventos: string[], idLote: string) {
  if (!eventos.length || eventos.length > 20) throw new Error("O lote deve ter de 1 a 20 eventos.");
  return envelope(
    '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">' +
      `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${idLote.replace(/\D/g, "").slice(0, 15) || "1"}</idLote>${eventos.join("")}</envEvento>` +
      "</nfeDadosMsg>",
  );
}

export interface RetornoEvento {
  chave: string;
  cStat: string;
  xMotivo: string;
  protocolo: string | null;
}

/** Lote: 128 = processado. Evento: 135/136 = registrado; 573 = já registrado antes (duplicidade). */
export function lerRetornoEventos(xml: string): { cStat: string; xMotivo: string; eventos: RetornoEvento[] } {
  const ret = achar(lerXml(xml), "retEnvEvento");
  if (!ret) throw new Error("Resposta da SEFAZ sem o retorno do lote de eventos (retEnvEvento).");
  const eventos = ((ret.retEvento as No[] | undefined) ?? []).map((e) => {
    const inf = (e.infEvento as No | undefined) ?? e;
    return { chave: texto(inf, "chNFe") ?? "", cStat: texto(inf, "cStat") ?? "", xMotivo: texto(inf, "xMotivo") ?? "", protocolo: texto(inf, "nProt") };
  });
  return { cStat: texto(ret, "cStat") ?? "", xMotivo: texto(ret, "xMotivo") ?? "", eventos };
}

export const EVENTO_REGISTRADO = new Set(["135", "136", "573"]);
