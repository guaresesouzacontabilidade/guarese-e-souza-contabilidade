import { XMLParser } from "fast-xml-parser";
import { chaveValida, MODELOS } from "./chave";

/**
 * Leitura de XMLs fiscais: NF-e (55), NFC-e (65), CT-e (57/67), eventos de
 * NF-e/CT-e (cancelamento, carta de correção, manifestação...) e NFS-e
 * (padrão nacional e ABRASF). Formatos desconhecidos são informados como
 * "não suportados".
 *
 * Importante: a leitura NÃO comprova autorização nem regularidade perante o
 * Fisco — apenas descreve o que está no arquivo.
 */

export type Operacao = "entrada" | "saida" | "nao_relacionada";

export interface ItemNota {
  numero_item: number;
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: string | null;
  valor_unitario: string | null;
  valor_total: string | null;
  valor_desconto: string | null;
  tributos: Record<string, string>;
}

export interface SugestaoLancamento {
  tipo: "receber" | "pagar";
  descricao: string;
  categoria_sistema: string | null;
  contraparte: { documento: string | null; nome: string | null };
  parcelas: { numero: number; vencimento: string | null; valor: string }[];
}

export interface NotaLida {
  tipo: "nota";
  modelo: string;
  tipo_documento: string;
  chave_acesso: string | null;
  identificador: string;
  numero: string | null;
  serie: string | null;
  data_emissao: string | null;
  emitente_documento: string | null;
  emitente_nome: string | null;
  emitente_uf: string | null;
  emitente_ie: string | null;
  destinatario_documento: string | null;
  destinatario_nome: string | null;
  destinatario_uf: string | null;
  tp_nf: string | null;
  operacao: Operacao;
  natureza_operacao: string | null;
  finalidade: string | null;
  cfops: string[];
  valor_total: string | null;
  valor_produtos: string | null;
  valor_servicos: string | null;
  valor_desconto: string | null;
  valor_frete: string | null;
  valor_outros: string | null;
  tributos: Record<string, string>;
  protocolo: { numero: string | null; cstat: string | null; motivo: string | null; data: string | null } | null;
  situacao_arquivo: "protocolo_autorizacao_no_arquivo" | "protocolo_nao_autorizado_no_arquivo" | "sem_protocolo" | "nao_aplicavel";
  duplicatas: { numero: string | null; vencimento: string | null; valor: string }[];
  pagamentos: { forma: string | null; valor: string | null }[];
  avisos: string[];
  relacionado_empresa: boolean;
  itens: ItemNota[];
  sugestao: SugestaoLancamento | null;
}

export interface EventoLido {
  tipo: "evento";
  modelo: string | null;
  chave_acesso: string;
  tipo_evento: string;
  descricao_evento: string;
  sequencia: number;
  data_evento: string | null;
  protocolo: string | null;
  cstat: string | null;
  justificativa: string | null;
  correcao: string | null;
  identificador: string;
  avisos: string[];
  cancelamento: boolean;
}

export type ResultadoLeituraXml =
  | { sucesso: true; dados: NotaLida | EventoLido }
  | { sucesso: false; motivo: "invalido" | "nao_suportado"; mensagem: string; raiz?: string };

export interface EmpresaReferencia {
  documento: string; // CNPJ ou CPF da empresa (somente dígitos)
}

const LIMITE_XML = 10 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (nome) => ["det", "dup", "detPag", "infQ", "Comp", "ObsCont"].includes(nome),
});

type No = Record<string, unknown>;

function no(v: unknown): No | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as No) : null;
}
function lista(v: unknown): No[] {
  if (Array.isArray(v)) return v.map(no).filter(Boolean) as No[];
  const n = no(v);
  return n ? [n] : [];
}
function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  const n = no(v);
  if (n && "#text" in n) return txt(n["#text"]);
  return null;
}
function caminho(raiz: unknown, ...partes: string[]): unknown {
  let atual: unknown = raiz;
  for (const p of partes) {
    const n = no(atual);
    if (!n) return undefined;
    atual = n[p];
  }
  return atual;
}
/** Busca em profundidade o primeiro nó com o nome informado. */
function buscar(raiz: unknown, nome: string, profundidade = 0): unknown {
  if (profundidade > 12) return undefined;
  if (Array.isArray(raiz)) {
    for (const r of raiz) {
      const achado = buscar(r, nome, profundidade + 1);
      if (achado !== undefined) return achado;
    }
    return undefined;
  }
  const n = no(raiz);
  if (!n) return undefined;
  if (nome in n) return n[nome];
  for (const v of Object.values(n)) {
    const achado = buscar(v, nome, profundidade + 1);
    if (achado !== undefined) return achado;
  }
  return undefined;
}
function decimal(v: unknown): string | null {
  const t = txt(v);
  if (!t) return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}
function digitos(v: unknown): string | null {
  const t = txt(v);
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  return d || null;
}
function docDe(n: unknown): string | null {
  return digitos(caminho(n, "CNPJ")) ?? digitos(caminho(n, "CPF")) ?? null;
}
function dataISO(v: unknown): string | null {
  const t = txt(v);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  return null;
}
function mesmaRaizCnpj(a: string | null, b: string) {
  return Boolean(a && a.length === 14 && b.length === 14 && a.slice(0, 8) === b.slice(0, 8));
}

const CFOP_VENDA = new Set([
  "101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "115", "116",
  "117", "118", "119", "120", "122", "123", "124", "125", "401", "402", "403", "405", "651", "652", "653", "654", "655", "656",
]);
const CFOP_SERVICO = new Set(["933", "301", "302", "303", "304", "305", "306", "307", "351", "352", "353", "354", "355", "356", "357"]);

const DESCRICAO_EVENTO: Record<string, string> = {
  "110110": "Carta de correção",
  "110111": "Cancelamento",
  "110112": "Cancelamento por substituição",
  "110140": "EPEC",
  "210200": "Confirmação da operação",
  "210210": "Ciência da emissão",
  "210220": "Desconhecimento da operação",
  "210240": "Operação não realizada",
  "610110": "Prestação de serviço em desacordo",
  "110180": "Comprovante de entrega",
};

export function lerXmlFiscal(conteudo: string, empresa: EmpresaReferencia): ResultadoLeituraXml {
  if (conteudo.length > LIMITE_XML) return { sucesso: false, motivo: "invalido", mensagem: "XML maior que 10 MB." };
  const texto = conteudo.replace(/^﻿/, "");
  // Proteção contra entidades externas e expansão de entidades (XXE / "billion laughs").
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) {
    return { sucesso: false, motivo: "invalido", mensagem: "XML com declaração DOCTYPE/ENTITY não é aceito por segurança." };
  }
  let arvore: No;
  try {
    arvore = parser.parse(texto, true) as No;
  } catch (e) {
    return { sucesso: false, motivo: "invalido", mensagem: `XML malformado: ${e instanceof Error ? e.message.slice(0, 160) : "erro de leitura"}` };
  }
  const raizes = Object.keys(arvore).filter((k) => !k.startsWith("?") && !k.startsWith("@_"));
  const raiz = raizes[0];
  if (!raiz) return { sucesso: false, motivo: "invalido", mensagem: "Arquivo sem conteúdo XML." };
  const corpo = arvore[raiz];
  const doc = empresa.documento.replace(/\D/g, "");

  switch (raiz) {
    case "nfeProc":
      return lerNfe(caminho(corpo, "NFe"), caminho(corpo, "protNFe"), doc);
    case "NFe":
      return lerNfe(corpo, undefined, doc);
    case "cteProc":
    case "cteOSProc":
      return lerCte(caminho(corpo, raiz === "cteProc" ? "CTe" : "CTeOS"), caminho(corpo, "protCTe"), doc);
    case "CTe":
    case "CTeOS":
      return lerCte(corpo, undefined, doc);
    case "procEventoNFe":
    case "procEventoCTe":
      return lerEvento(caminho(corpo, "evento") ?? caminho(corpo, "eventoCTe"), caminho(corpo, "retEvento") ?? caminho(corpo, "retEventoCTe"), raiz);
    case "evento":
    case "eventoCTe":
      return lerEvento(corpo, undefined, raiz);
    case "NFSe":
      return lerNfseNacional(corpo, doc);
    case "CompNfse":
    case "ConsultarNfseResposta":
    case "ConsultarNfseRpsResposta":
    case "ListaNfse":
    case "Nfse":
      return lerNfseAbrasf(corpo, raiz, doc);
    case "mdfeProc":
    case "MDFe":
      return { sucesso: false, motivo: "nao_suportado", mensagem: "MDF-e ainda não é suportado pelo portal. O arquivo foi guardado para o escritório.", raiz };
    case "CFe":
      return { sucesso: false, motivo: "nao_suportado", mensagem: "CF-e SAT ainda não é suportado pelo portal. O arquivo foi guardado para o escritório.", raiz };
    case "resNFe":
    case "resEvento":
      return { sucesso: false, motivo: "nao_suportado", mensagem: "Arquivo de resumo (resNFe/resEvento) não contém os dados completos da nota. Envie o XML completo.", raiz };
    default:
      return { sucesso: false, motivo: "nao_suportado", mensagem: `Tipo de XML não reconhecido (${raiz}). O arquivo foi guardado para análise do escritório.`, raiz };
  }
}

function situacaoProtocolo(prot: unknown): { protocolo: NotaLida["protocolo"]; situacao: NotaLida["situacao_arquivo"]; aviso: string | null } {
  const inf = caminho(prot, "infProt");
  if (!inf) {
    return {
      protocolo: null,
      situacao: "sem_protocolo",
      aviso: "O XML não contém protocolo de autorização (pode ser apenas o arquivo assinado, sem transmissão). A situação no Fisco não foi consultada.",
    };
  }
  const cstat = txt(caminho(inf, "cStat"));
  const protocolo = { numero: txt(caminho(inf, "nProt")), cstat, motivo: txt(caminho(inf, "xMotivo")), data: dataISO(caminho(inf, "dhRecbto")) };
  if (cstat === "100" || cstat === "150") {
    return { protocolo, situacao: "protocolo_autorizacao_no_arquivo", aviso: null };
  }
  return {
    protocolo,
    situacao: "protocolo_nao_autorizado_no_arquivo",
    aviso: `O protocolo presente no arquivo não é de autorização (cStat ${cstat ?? "?"}: ${protocolo.motivo ?? "sem motivo"}).`,
  };
}

function lerNfe(nfe: unknown, prot: unknown, doc: string): ResultadoLeituraXml {
  const inf = caminho(nfe, "infNFe");
  if (!no(inf)) return { sucesso: false, motivo: "invalido", mensagem: "Estrutura de NF-e inválida (infNFe ausente)." };
  const avisos: string[] = [];
  const id = txt(caminho(inf, "@_Id")) ?? "";
  let chave = id.replace(/^NFe/, "");
  const chaveProt = txt(caminho(prot, "infProt", "chNFe"));
  if (!/^\d{44}$/.test(chave) && chaveProt) chave = chaveProt;
  if (!/^\d{44}$/.test(chave)) return { sucesso: false, motivo: "invalido", mensagem: "Chave de acesso não encontrada no XML." };
  if (!chaveValida(chave)) avisos.push("Dígito verificador da chave de acesso não confere.");
  if (chaveProt && chaveProt !== chave) avisos.push("A chave do protocolo não corresponde à chave da nota.");

  const ide = caminho(inf, "ide");
  const emit = caminho(inf, "emit");
  const dest = caminho(inf, "dest");
  const modelo = txt(caminho(ide, "mod")) ?? chave.slice(20, 22);
  const tpNF = txt(caminho(ide, "tpNF"));
  const finNFe = txt(caminho(ide, "finNFe"));
  const emitDoc = docDe(emit);
  const destDoc = docDe(dest) ?? digitos(caminho(dest, "idEstrangeiro"));
  const tot = caminho(inf, "total", "ICMSTot");

  let operacao: Operacao = "nao_relacionada";
  let relacionado = false;
  if (emitDoc === doc) {
    relacionado = true;
    operacao = tpNF === "0" ? "entrada" : "saida";
    if (tpNF === "0") avisos.push("Nota de entrada emitida pela própria empresa.");
  } else if (destDoc === doc) {
    relacionado = true;
    operacao = "entrada";
    if (tpNF === "0") avisos.push("Nota de entrada emitida por terceiro (ex.: devolução). Confira a natureza da operação.");
  } else if (mesmaRaizCnpj(emitDoc, doc) || mesmaRaizCnpj(destDoc, doc)) {
    relacionado = true;
    operacao = mesmaRaizCnpj(emitDoc, doc) ? (tpNF === "0" ? "entrada" : "saida") : "entrada";
    avisos.push("CNPJ de outro estabelecimento (filial/matriz) da mesma empresa.");
  } else {
    avisos.push("Nenhum CNPJ/CPF do documento corresponde ao da empresa. Verifique se o arquivo foi enviado para a empresa correta.");
  }

  const itens: ItemNota[] = lista(caminho(inf, "det")).map((d, i) => {
    const prod = caminho(d, "prod");
    const imposto = caminho(d, "imposto");
    const tributos: Record<string, string> = {};
    const vICMS = decimal(buscar(caminho(imposto, "ICMS"), "vICMS"));
    const vIPI = decimal(buscar(caminho(imposto, "IPI"), "vIPI"));
    const vPIS = decimal(buscar(caminho(imposto, "PIS"), "vPIS"));
    const vCOFINS = decimal(buscar(caminho(imposto, "COFINS"), "vCOFINS"));
    if (vICMS) tributos.icms = vICMS;
    if (vIPI) tributos.ipi = vIPI;
    if (vPIS) tributos.pis = vPIS;
    if (vCOFINS) tributos.cofins = vCOFINS;
    return {
      numero_item: Number(txt(caminho(d, "@_nItem")) ?? i + 1),
      codigo: txt(caminho(prod, "cProd")),
      descricao: txt(caminho(prod, "xProd")),
      ncm: txt(caminho(prod, "NCM")),
      cfop: txt(caminho(prod, "CFOP")),
      unidade: txt(caminho(prod, "uCom")),
      quantidade: decimal(caminho(prod, "qCom")),
      valor_unitario: decimal(caminho(prod, "vUnCom")),
      valor_total: decimal(caminho(prod, "vProd")),
      valor_desconto: decimal(caminho(prod, "vDesc")),
      tributos,
    };
  });
  const cfops = [...new Set(itens.map((i) => i.cfop).filter(Boolean) as string[])];

  const tributos: Record<string, string> = {};
  for (const [campo, nome] of [
    ["vBC", "base_icms"], ["vICMS", "icms"], ["vICMSDeson", "icms_desonerado"], ["vFCP", "fcp"], ["vBCST", "base_icms_st"],
    ["vST", "icms_st"], ["vFCPST", "fcp_st"], ["vII", "ii"], ["vIPI", "ipi"], ["vPIS", "pis"], ["vCOFINS", "cofins"], ["vTotTrib", "total_tributos_aprox"],
  ] as const) {
    const v = decimal(caminho(tot, campo));
    if (v && v !== "0.00" && v !== "0") tributos[nome] = v;
  }

  const duplicatas = lista(caminho(inf, "cobr", "dup")).map((d) => ({
    numero: txt(caminho(d, "nDup")),
    vencimento: dataISO(caminho(d, "dVenc")),
    valor: decimal(caminho(d, "vDup")) ?? "0",
  }));
  const pagamentos = lista(caminho(inf, "pag", "detPag")).map((p) => ({ forma: txt(caminho(p, "tPag")), valor: decimal(caminho(p, "vPag")) }));

  const prot_ = situacaoProtocolo(prot);
  if (prot_.aviso) avisos.push(prot_.aviso);

  const numero = txt(caminho(ide, "nNF"));
  const valorTotal = decimal(caminho(tot, "vNF"));
  const dataEmissao = dataISO(caminho(ide, "dhEmi")) ?? dataISO(caminho(ide, "dEmi"));
  const nota: NotaLida = {
    tipo: "nota",
    modelo,
    tipo_documento: MODELOS[modelo] ?? `Modelo ${modelo}`,
    chave_acesso: chave,
    identificador: chave,
    numero,
    serie: txt(caminho(ide, "serie")),
    data_emissao: dataEmissao,
    emitente_documento: emitDoc,
    emitente_nome: txt(caminho(emit, "xNome")),
    emitente_uf: txt(caminho(emit, "enderEmit", "UF")),
    emitente_ie: txt(caminho(emit, "IE")),
    destinatario_documento: destDoc,
    destinatario_nome: txt(caminho(dest, "xNome")),
    destinatario_uf: txt(caminho(dest, "enderDest", "UF")),
    tp_nf: tpNF,
    operacao,
    natureza_operacao: txt(caminho(ide, "natOp")),
    finalidade: finNFe,
    cfops,
    valor_total: valorTotal,
    valor_produtos: decimal(caminho(tot, "vProd")),
    valor_servicos: decimal(caminho(inf, "total", "ISSQNtot", "vServ")),
    valor_desconto: decimal(caminho(tot, "vDesc")),
    valor_frete: decimal(caminho(tot, "vFrete")),
    valor_outros: decimal(caminho(tot, "vOutro")),
    tributos,
    protocolo: prot_.protocolo,
    situacao_arquivo: prot_.situacao,
    duplicatas,
    pagamentos,
    avisos,
    relacionado_empresa: relacionado,
    itens,
    sugestao: null,
  };

  // Sugestão de lançamento (somente NF-e normal, com operação de compra/venda identificável)
  if (relacionado && modelo === "55" && finNFe === "1" && valorTotal && prot_.situacao !== "protocolo_nao_autorizado_no_arquivo") {
    const finais = cfops.map((c) => c.slice(1));
    const venda = finais.some((f) => CFOP_VENDA.has(f));
    const servico = finais.some((f) => CFOP_SERVICO.has(f));
    if (venda || servico) {
      const parcelas = duplicatas.length
        ? duplicatas.map((d, i) => ({ numero: i + 1, vencimento: d.vencimento, valor: d.valor }))
        : [{ numero: 1, vencimento: dataEmissao?.slice(0, 10) ?? null, valor: valorTotal }];
      if (operacao === "saida") {
        nota.sugestao = {
          tipo: "receber",
          descricao: `NF-e ${numero ?? ""} — ${nota.destinatario_nome ?? "cliente"}`.trim(),
          categoria_sistema: venda ? "VENDAS" : "SERVICOS",
          contraparte: { documento: destDoc, nome: nota.destinatario_nome },
          parcelas,
        };
      } else if (operacao === "entrada") {
        nota.sugestao = {
          tipo: "pagar",
          descricao: `NF-e ${numero ?? ""} — ${nota.emitente_nome ?? "fornecedor"}`.trim(),
          categoria_sistema: null,
          contraparte: { documento: emitDoc, nome: nota.emitente_nome },
          parcelas,
        };
      }
    }
  }
  if (modelo === "65") nota.avisos.push("NFC-e: a receita é reconhecida pelos recebimentos (caixa, maquininha), sem lançamento a receber automático.");
  return { sucesso: true, dados: nota };
}

function lerCte(cte: unknown, prot: unknown, doc: string): ResultadoLeituraXml {
  const inf = caminho(cte, "infCte") ?? caminho(cte, "infCTeOS");
  if (!no(inf)) return { sucesso: false, motivo: "invalido", mensagem: "Estrutura de CT-e inválida (infCte ausente)." };
  const avisos: string[] = [];
  const id = txt(caminho(inf, "@_Id")) ?? "";
  let chave = id.replace(/^CTe/, "");
  const chaveProt = txt(caminho(prot, "infProt", "chCTe"));
  if (!/^\d{44}$/.test(chave) && chaveProt) chave = chaveProt;
  if (!/^\d{44}$/.test(chave)) return { sucesso: false, motivo: "invalido", mensagem: "Chave de acesso do CT-e não encontrada." };
  if (!chaveValida(chave)) avisos.push("Dígito verificador da chave de acesso não confere.");

  const ide = caminho(inf, "ide");
  const emit = caminho(inf, "emit");
  const rem = caminho(inf, "rem");
  const dest = caminho(inf, "dest");
  const exped = caminho(inf, "exped");
  const receb = caminho(inf, "receb");
  const modelo = txt(caminho(ide, "mod")) ?? chave.slice(20, 22);
  const emitDoc = docDe(emit);

  // Tomador do serviço
  let tomadorDoc: string | null = null;
  let tomadorNome: string | null = null;
  const toma3 = txt(caminho(ide, "toma3", "toma")) ?? txt(caminho(ide, "toma03", "toma"));
  const toma4 = caminho(ide, "toma4") ?? caminho(ide, "toma");
  if (toma3 !== null) {
    const ref = [rem, exped, receb, dest][Number(toma3)];
    tomadorDoc = docDe(ref);
    tomadorNome = txt(caminho(ref, "xNome"));
  } else if (no(toma4)) {
    tomadorDoc = docDe(toma4);
    tomadorNome = txt(caminho(toma4, "xNome"));
  }

  let operacao: Operacao = "nao_relacionada";
  let relacionado = false;
  if (emitDoc === doc) {
    relacionado = true;
    operacao = "saida";
  } else if (tomadorDoc === doc) {
    relacionado = true;
    operacao = "entrada";
  } else if ([rem, dest, exped, receb].some((p) => docDe(p) === doc)) {
    relacionado = true;
    avisos.push("A empresa participa do transporte, mas não é a tomadora do serviço (sem obrigação de pagamento do frete).");
  } else {
    avisos.push("Nenhum CNPJ/CPF do CT-e corresponde ao da empresa.");
  }

  const valorTotal = decimal(caminho(inf, "vPrest", "vTPrest"));
  const valorReceber = decimal(caminho(inf, "vPrest", "vRec")) ?? valorTotal;
  const prot_ = situacaoProtocolo(prot);
  if (prot_.aviso) avisos.push(prot_.aviso);
  const numero = txt(caminho(ide, "nCT"));
  const dataEmissao = dataISO(caminho(ide, "dhEmi"));
  const vICMS = decimal(buscar(caminho(inf, "imp"), "vICMS"));
  const cfop = txt(caminho(ide, "CFOP"));

  const nota: NotaLida = {
    tipo: "nota",
    modelo,
    tipo_documento: MODELOS[modelo] ?? "CT-e",
    chave_acesso: chave,
    identificador: chave,
    numero,
    serie: txt(caminho(ide, "serie")),
    data_emissao: dataEmissao,
    emitente_documento: emitDoc,
    emitente_nome: txt(caminho(emit, "xNome")),
    emitente_uf: txt(caminho(emit, "enderEmit", "UF")),
    emitente_ie: txt(caminho(emit, "IE")),
    destinatario_documento: tomadorDoc,
    destinatario_nome: tomadorNome,
    destinatario_uf: null,
    tp_nf: null,
    operacao,
    natureza_operacao: txt(caminho(ide, "natOp")),
    finalidade: txt(caminho(ide, "tpCTe")),
    cfops: cfop ? [cfop] : [],
    valor_total: valorTotal,
    valor_produtos: null,
    valor_servicos: valorTotal,
    valor_desconto: null,
    valor_frete: valorTotal,
    valor_outros: null,
    tributos: vICMS ? { icms: vICMS } : {},
    protocolo: prot_.protocolo,
    situacao_arquivo: prot_.situacao,
    duplicatas: [],
    pagamentos: [],
    avisos,
    relacionado_empresa: relacionado,
    itens: [],
    sugestao: null,
  };
  if (relacionado && valorReceber && operacao !== "nao_relacionada" && prot_.situacao !== "protocolo_nao_autorizado_no_arquivo") {
    nota.sugestao =
      operacao === "saida"
        ? {
            tipo: "receber",
            descricao: `CT-e ${numero ?? ""} — ${tomadorNome ?? "tomador"}`.trim(),
            categoria_sistema: "SERVICOS",
            contraparte: { documento: tomadorDoc, nome: tomadorNome },
            parcelas: [{ numero: 1, vencimento: dataEmissao?.slice(0, 10) ?? null, valor: valorReceber }],
          }
        : {
            tipo: "pagar",
            descricao: `Frete CT-e ${numero ?? ""} — ${nota.emitente_nome ?? "transportadora"}`.trim(),
            categoria_sistema: null,
            contraparte: { documento: emitDoc, nome: nota.emitente_nome },
            parcelas: [{ numero: 1, vencimento: dataEmissao?.slice(0, 10) ?? null, valor: valorReceber }],
          };
  }
  return { sucesso: true, dados: nota };
}

function lerEvento(evento: unknown, ret: unknown, raiz: string): ResultadoLeituraXml {
  const inf = caminho(evento, "infEvento");
  if (!no(inf)) return { sucesso: false, motivo: "invalido", mensagem: "Estrutura de evento inválida (infEvento ausente)." };
  const avisos: string[] = [];
  const chave = txt(caminho(inf, "chNFe")) ?? txt(caminho(inf, "chCTe")) ?? "";
  if (!/^\d{44}$/.test(chave)) return { sucesso: false, motivo: "invalido", mensagem: "Evento sem chave de acesso válida." };
  const tipoEvento = txt(caminho(inf, "tpEvento")) ?? "";
  const seq = Number(txt(caminho(inf, "nSeqEvento")) ?? "1");
  const det = caminho(inf, "detEvento");
  const id = txt(caminho(inf, "@_Id")) ?? `ID${tipoEvento}${chave}${String(seq).padStart(2, "0")}`;
  const retInf = caminho(ret, "infEvento");
  const cstat = txt(caminho(retInf, "cStat"));
  if (!retInf) avisos.push("O arquivo não contém o retorno de registro do evento (sem protocolo). A situação no Fisco não foi consultada.");
  else if (!["135", "136", "155"].includes(cstat ?? "")) avisos.push(`O evento não consta como registrado no arquivo (cStat ${cstat ?? "?"}).`);
  const cancelamento = ["110111", "110112"].includes(tipoEvento);
  return {
    sucesso: true,
    dados: {
      tipo: "evento",
      modelo: chave.slice(20, 22) || (raiz.includes("CTe") ? "57" : "55"),
      chave_acesso: chave,
      tipo_evento: tipoEvento,
      descricao_evento: txt(caminho(det, "descEvento")) ?? DESCRICAO_EVENTO[tipoEvento] ?? `Evento ${tipoEvento}`,
      sequencia: Number.isFinite(seq) ? seq : 1,
      data_evento: dataISO(caminho(inf, "dhEvento")),
      protocolo: txt(caminho(retInf, "nProt")) ?? txt(caminho(det, "nProt")),
      cstat,
      justificativa: txt(caminho(det, "xJust")),
      correcao: txt(caminho(det, "xCorrecao")),
      identificador: id,
      avisos,
      cancelamento,
    },
  };
}

function lerNfseNacional(nfse: unknown, doc: string): ResultadoLeituraXml {
  const inf = caminho(nfse, "infNFSe");
  if (!no(inf)) return { sucesso: false, motivo: "invalido", mensagem: "Estrutura de NFS-e (padrão nacional) inválida." };
  const avisos: string[] = [];
  const id = txt(caminho(inf, "@_Id")) ?? "";
  const infDps = caminho(inf, "DPS", "infDPS");
  const prest = caminho(infDps, "prest");
  const toma = caminho(infDps, "toma");
  const emit = caminho(inf, "emit");
  const prestDoc = docDe(prest) ?? docDe(emit);
  const tomaDoc = docDe(toma);
  const numero = txt(caminho(inf, "nNFSe"));
  const valorServ = decimal(caminho(infDps, "valores", "vServPrest", "vServ"));
  const valorLiq = decimal(caminho(inf, "valores", "vLiq")) ?? valorServ;
  const dataEmissao = dataISO(caminho(infDps, "dhEmi")) ?? dataISO(caminho(inf, "dhProc"));
  const competencia = dataISO(caminho(infDps, "dCompet"));
  if (!id && !numero) return { sucesso: false, motivo: "invalido", mensagem: "NFS-e sem identificação (Id ou número)." };

  let operacao: Operacao = "nao_relacionada";
  let relacionado = false;
  if (prestDoc === doc) {
    relacionado = true;
    operacao = "saida";
  } else if (tomaDoc === doc) {
    relacionado = true;
    operacao = "entrada";
  } else avisos.push("Nenhum CNPJ/CPF da NFS-e corresponde ao da empresa.");

  const tributos: Record<string, string> = {};
  const vISS = decimal(buscar(caminho(inf, "valores"), "vISSQN")) ?? decimal(buscar(caminho(infDps, "valores"), "vISSQN"));
  if (vISS) tributos.iss = vISS;
  const tpRet = txt(buscar(caminho(infDps, "valores"), "tpRetISSQN"));
  if (tpRet && tpRet !== "1") tributos.iss_retido = "sim";

  const nota: NotaLida = {
    tipo: "nota",
    modelo: "nfse_nacional",
    tipo_documento: "NFS-e",
    chave_acesso: null,
    identificador: id || `NFSE:${prestDoc}:${numero}`,
    numero,
    serie: txt(caminho(infDps, "serie")),
    data_emissao: dataEmissao ?? (competencia ? `${competencia}T12:00:00-03:00` : null),
    emitente_documento: prestDoc,
    emitente_nome: txt(caminho(emit, "xNome")) ?? txt(caminho(prest, "xNome")),
    emitente_uf: null,
    emitente_ie: null,
    destinatario_documento: tomaDoc,
    destinatario_nome: txt(caminho(toma, "xNome")),
    destinatario_uf: null,
    tp_nf: null,
    operacao,
    natureza_operacao: txt(caminho(infDps, "serv", "cServ", "xDescServ")),
    finalidade: null,
    cfops: [],
    valor_total: valorLiq,
    valor_produtos: null,
    valor_servicos: valorServ,
    valor_desconto: null,
    valor_frete: null,
    valor_outros: null,
    tributos,
    protocolo: null,
    situacao_arquivo: "nao_aplicavel",
    duplicatas: [],
    pagamentos: [],
    avisos,
    relacionado_empresa: relacionado,
    itens: [],
    sugestao: null,
  };
  if (relacionado && valorLiq) {
    nota.sugestao = {
      tipo: operacao === "saida" ? "receber" : "pagar",
      descricao: `NFS-e ${numero ?? ""} — ${(operacao === "saida" ? nota.destinatario_nome : nota.emitente_nome) ?? ""}`.trim(),
      categoria_sistema: operacao === "saida" ? "SERVICOS" : null,
      contraparte: operacao === "saida" ? { documento: tomaDoc, nome: nota.destinatario_nome } : { documento: prestDoc, nome: nota.emitente_nome },
      parcelas: [{ numero: 1, vencimento: (dataEmissao ?? competencia)?.slice(0, 10) ?? null, valor: valorLiq }],
    };
  }
  return { sucesso: true, dados: nota };
}

function lerNfseAbrasf(corpo: unknown, raiz: string, doc: string): ResultadoLeituraXml {
  const infNfse = buscar(raiz === "Nfse" ? { Nfse: corpo } : corpo, "InfNfse");
  if (!no(infNfse)) return { sucesso: false, motivo: "nao_suportado", mensagem: "Layout de NFS-e municipal não reconhecido. O arquivo foi guardado para o escritório.", raiz };
  const avisos: string[] = [];
  const numero = txt(caminho(infNfse, "Numero"));
  const prestador = buscar(infNfse, "PrestadorServico") ?? buscar(infNfse, "Prestador");
  const tomador = buscar(infNfse, "TomadorServico") ?? buscar(infNfse, "Tomador");
  const cpfCnpj = (n: unknown) => digitos(buscar(n, "Cnpj")) ?? digitos(buscar(n, "Cpf"));
  const prestDoc = cpfCnpj(prestador);
  const tomaDoc = cpfCnpj(tomador);
  const valores = buscar(infNfse, "ValoresNfse") ?? buscar(infNfse, "Valores");
  const valorServ = decimal(buscar(infNfse, "ValorServicos"));
  const valorLiq = decimal(buscar(valores, "ValorLiquidoNfse")) ?? valorServ;
  const dataEmissao = txt(caminho(infNfse, "DataEmissao"));
  const competencia = txt(buscar(infNfse, "Competencia"));
  const municipio = txt(buscar(buscar(infNfse, "OrgaoGerador"), "CodigoMunicipio")) ?? "";
  const cancelada = Boolean(buscar(corpo, "NfseCancelamento"));
  if (cancelada) avisos.push("O arquivo contém o registro de cancelamento desta NFS-e.");
  if (!numero || !prestDoc) return { sucesso: false, motivo: "invalido", mensagem: "NFS-e sem número ou sem CNPJ do prestador." };

  let operacao: Operacao = "nao_relacionada";
  let relacionado = false;
  if (prestDoc === doc) {
    relacionado = true;
    operacao = "saida";
  } else if (tomaDoc === doc) {
    relacionado = true;
    operacao = "entrada";
  } else avisos.push("Nenhum CNPJ/CPF da NFS-e corresponde ao da empresa.");

  const tributos: Record<string, string> = {};
  const vIss = decimal(buscar(infNfse, "ValorIss"));
  if (vIss) tributos.iss = vIss;
  const issRetido = txt(buscar(infNfse, "IssRetido"));
  if (issRetido === "1") tributos.iss_retido = "sim";

  const dataIso = dataEmissao && /^\d{4}-\d{2}-\d{2}/.test(dataEmissao) ? dataEmissao : competencia && /^\d{4}-\d{2}/.test(competencia) ? competencia : null;
  const nota: NotaLida = {
    tipo: "nota",
    modelo: "nfse_abrasf",
    tipo_documento: "NFS-e",
    chave_acesso: null,
    identificador: `NFSE:${prestDoc}:${numero}:${municipio}`,
    numero,
    serie: null,
    data_emissao: dataIso,
    emitente_documento: prestDoc,
    emitente_nome: txt(buscar(prestador, "RazaoSocial")),
    emitente_uf: null,
    emitente_ie: null,
    destinatario_documento: tomaDoc,
    destinatario_nome: txt(buscar(tomador, "RazaoSocial")),
    destinatario_uf: null,
    tp_nf: null,
    operacao,
    natureza_operacao: txt(buscar(infNfse, "Discriminacao"))?.slice(0, 300) ?? null,
    finalidade: null,
    cfops: [],
    valor_total: valorLiq,
    valor_produtos: null,
    valor_servicos: valorServ,
    valor_desconto: decimal(buscar(infNfse, "DescontoIncondicionado")),
    valor_frete: null,
    valor_outros: null,
    tributos,
    protocolo: null,
    situacao_arquivo: "nao_aplicavel",
    duplicatas: [],
    pagamentos: [],
    avisos,
    relacionado_empresa: relacionado,
    itens: [],
    sugestao: null,
  };
  if (relacionado && valorLiq && !cancelada) {
    nota.sugestao = {
      tipo: operacao === "saida" ? "receber" : "pagar",
      descricao: `NFS-e ${numero} — ${(operacao === "saida" ? nota.destinatario_nome : nota.emitente_nome) ?? ""}`.trim(),
      categoria_sistema: operacao === "saida" ? "SERVICOS" : null,
      contraparte: operacao === "saida" ? { documento: tomaDoc, nome: nota.destinatario_nome } : { documento: prestDoc, nome: nota.emitente_nome },
      parcelas: [{ numero: 1, vencimento: dataIso?.slice(0, 10) ?? null, valor: valorLiq }],
    };
  }
  return { sucesso: true, dados: nota };
}

/** Categoria do documento sugerida a partir do XML lido. */
export function categoriaDoXml(dados: NotaLida | EventoLido): string {
  if (dados.tipo === "evento") return "eventos_fiscais";
  if (dados.modelo.startsWith("nfse")) return "nfse";
  if (dados.modelo === "57" || dados.modelo === "67") return "cte_xml";
  return dados.operacao === "saida" ? "nfe_saida_xml" : "nfe_entrada_xml";
}
