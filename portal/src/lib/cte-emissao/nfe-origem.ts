import { XMLParser } from "fast-xml-parser";

/**
 * Dados de uma NF-e (XML da nota) para preencher o CT-e que transporta a
 * carga: quem envia (emitente da nota, o remetente), quem recebe (o
 * destinatário), o produto predominante, o peso (volumes da nota ou, sem
 * eles, a quantidade em quilos ou toneladas) e o valor da carga (total da
 * nota). Só lê o que está no XML.
 */

type Obj = Record<string, unknown>;

export interface ParticipanteDaNfe {
  tipo: "cnpj" | "cpf";
  documento: string;
  nome: string;
  /** 1 contribuinte; 2 isento; 9 não contribuinte */
  indicador_ie: number;
  inscricao_estadual: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio_ibge: string;
  uf: string;
  cep: string | null;
  telefone: string | null;
  email: string | null;
}

export interface NfeParaCte {
  chave: string;
  numero: string | null;
  modelo: string | null;
  remetente: ParticipanteDaNfe | null;
  destinatario: ParticipanteDaNfe | null;
  produto: string | null;
  pesoKg: string | null;
  valor: string | null;
  /** Modalidade do frete da nota (0 remetente/CIF; 1 destinatário/FOB; 2 terceiros; 3/4 próprio; 9 sem frete) */
  modalidadeFrete: number | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => ["det", "vol"].includes(nome),
});

function no(o: unknown, ...caminho: string[]): Obj | null {
  let atual: unknown = o;
  for (const c of caminho) {
    if (!atual || typeof atual !== "object") return null;
    atual = (atual as Obj)[c];
  }
  return atual && typeof atual === "object" ? (atual as Obj) : null;
}
function val(o: unknown, ...caminho: string[]): string | null {
  let atual: unknown = o;
  for (const c of caminho) {
    if (!atual || typeof atual !== "object") return null;
    atual = (atual as Obj)[c];
  }
  if (atual == null) return null;
  if (typeof atual === "object") return ((atual as Obj)["#text"] as string) ?? null;
  const t = String(atual).trim();
  return t || null;
}

function participante(p: Obj | null, endereco: Obj | null, indicador: number): ParticipanteDaNfe | null {
  const cnpj = val(p, "CNPJ");
  const cpf = val(p, "CPF");
  const doc = (cnpj ?? cpf ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const mun = val(endereco, "cMun");
  if (!doc || !mun || !/^\d{7}$/.test(mun)) return null;
  const ie = val(p, "IE");
  const ind = ie && /^\d+$/.test(ie) ? 1 : ie === "ISENTO" ? 2 : indicador;
  return {
    tipo: cnpj ? "cnpj" : "cpf",
    documento: doc,
    nome: (val(p, "xNome") ?? "").slice(0, 60),
    indicador_ie: ind,
    inscricao_estadual: ind === 1 ? ie : null,
    logradouro: val(endereco, "xLgr") ?? "",
    numero: val(endereco, "nro") ?? "SN",
    complemento: val(endereco, "xCpl"),
    bairro: val(endereco, "xBairro") ?? "",
    municipio_ibge: mun,
    uf: val(endereco, "UF") ?? "",
    cep: val(endereco, "CEP"),
    telefone: val(endereco, "fone"),
    email: val(p, "email"),
  };
}

/** Quilos a partir da quantidade, quando a unidade é de peso (KG, T/TON, SC de 60 kg). */
function pesoPelaQuantidade(unidade: string | null, quantidade: string | null): number | null {
  const q = Number(quantidade);
  if (!unidade || !Number.isFinite(q) || q <= 0) return null;
  const u = unidade.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (u === "KG" || u === "KGS" || u === "QUILO") return q;
  if (u === "T" || u === "TON" || u === "TONELADA" || u === "TN") return q * 1000;
  if (u === "SC" || u === "SC60" || u === "SACA") return q * 60;
  return null;
}

export function lerNfeParaCte(xml: string): NfeParaCte | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  let raiz: Obj;
  try {
    raiz = parser.parse(xml) as Obj;
  } catch {
    return null;
  }
  const inf = no(raiz, "nfeProc", "NFe", "infNFe") ?? no(raiz, "NFe", "infNFe");
  if (!inf) return null;
  const chave = String(inf["@_Id"] ?? "").replace(/^NFe/, "");
  const emit = no(inf, "emit");
  const dest = no(inf, "dest");
  const dets = (inf.det as Obj[] | undefined) ?? [];
  const vols = (no(inf, "transp")?.vol as Obj[] | undefined) ?? [];

  // Peso: volumes da nota (bruto, senão líquido); sem volumes, a quantidade em unidade de peso
  let peso = vols.reduce((s, v) => s + (Number(val(v, "pesoB") ?? val(v, "pesoL")) || 0), 0);
  if (!(peso > 0)) {
    peso = dets.reduce((s, d) => s + (pesoPelaQuantidade(val(d, "prod", "uCom"), val(d, "prod", "qCom")) ?? 0), 0);
  }
  // Produto predominante: o de maior valor
  const principal = [...dets].sort((a, b) => Number(val(b, "prod", "vProd") ?? 0) - Number(val(a, "prod", "vProd") ?? 0))[0];
  const modFrete = val(inf, "transp", "modFrete");
  return {
    chave,
    numero: val(inf, "ide", "nNF"),
    modelo: val(inf, "ide", "mod"),
    remetente: participante(emit, no(emit, "enderEmit"), 1),
    destinatario: participante(dest, no(dest, "enderDest"), Number(val(dest, "indIEDest") ?? 9) || 9),
    produto: principal ? (val(principal, "prod", "xProd") ?? "").slice(0, 60) || null : null,
    pesoKg: peso > 0 ? String(Math.round(peso * 10_000) / 10_000) : null,
    valor: val(inf, "total", "ICMSTot", "vNF"),
    modalidadeFrete: modFrete != null && /^\d$/.test(modFrete) ? Number(modFrete) : null,
  };
}
