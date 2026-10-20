import { createHash, createPrivateKey, sign, X509Certificate } from "node:crypto";

/**
 * DPS (Declaração de Prestação de Serviço) do Sistema Nacional NFS-e, leiaute
 * 1.01 (esquemas XSD de 09/02/2026), e o pedido de registro de evento de
 * cancelamento (e101101).
 *
 * O XML é gerado já na forma canônica (C14N inclusiva): sem espaços entre os
 * elementos, namespace declarado no elemento e texto com só &, < e >
 * escapados. Assim o resumo (digest) calculado aqui é o mesmo que a Sefin
 * Nacional calcula ao conferir a assinatura (RSA-SHA1, como no padrão
 * nacional de assinatura dos documentos fiscais).
 *
 * Regras do leiaute seguidas (Anexo I, RN DPS_NFS-e):
 *  - emitente é o prestador (tpEmit = 1): nome e endereço do prestador não
 *    vão na DPS (vêm do cadastro CNPJ); a inscrição municipal só vai quando a
 *    empresa tem cadastro complementar no município;
 *  - tomador com CNPJ leva o endereço nacional; com CPF, o endereço é opcional;
 *  - alíquota do ISS (pAliq): para o Simples ME/EPP com ISS pelo SN, só com
 *    retenção pelo tomador; nos demais casos o município parametriza;
 *  - tributos aproximados: Simples ME/EPP informa a alíquota do SN
 *    (pTotTribSN); não optante informa os percentuais (pTotTrib); o MEI
 *    pode não informar (indTotTrib = 0);
 *  - o grupo de IBS/CBS é opcional em 2026 (e só obrigatório para o Simples a
 *    partir de 2027): não é enviado.
 */

export const NS_NFSE = "http://www.sped.fazenda.gov.br/nfse";
const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
export const VERSAO_LEIAUTE = "1.01";
export const VERSAO_APLICATIVO = "PortalGuaresesON-1.0";

export type AmbienteNfse = "producao" | "homologacao";

// -----------------------------------------------------------------------------
// Texto
// -----------------------------------------------------------------------------

/** Texto em forma canônica: só &, < e > escapados (aspas ficam como estão). */
export function textoXml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TROCAS: [RegExp, string][] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[‐-―−]/g, "-"],
  [/…/g, "..."],
  [/[•●▪]/g, "-"],
  [/[  -   　]/g, " "],
  [/€/g, "EUR"],
];

/**
 * Texto aceito pelo leiaute: os campos de texto simples só aceitam
 * caracteres de "!" a "ÿ" (Latin-1), com espaços apenas entre palavras e
 * sem quebra de linha. Aspas e travessões "tipográficos" viram os comuns; o
 * que sobrar fora do Latin-1 (emojis, por exemplo) é retirado.
 */
export function textoLeiaute(v: string, max: number, opcoes: { quebras?: boolean } = {}): string {
  let t = v.normalize("NFC").replace(/\r\n?/g, "\n");
  for (const [de, para] of TROCAS) t = t.replace(de, para);
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").replace(/[^\n\t -ÿ]/g, "");
  if (opcoes.quebras) {
    t = t
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    t = t.replace(/\s+/g, " ").trim();
  }
  return t.slice(0, max).trim();
}

/** Valor com duas casas (padrões TSDec do leiaute: "0" ou "123.45"). */
export function decimal(v: string | number, maxInteiros: number): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido: ${v}`);
  const s = n.toFixed(2);
  if (s.split(".")[0].length > maxInteiros) throw new Error(`Valor fora do limite do leiaute: ${v}`);
  return s === "0.00" ? "0" : s;
}

const el = (nome: string, conteudo: string | null | undefined) => (conteudo == null || conteudo === "" ? "" : `<${nome}>${conteudo}</${nome}>`);
const txt = (nome: string, valor: string | null | undefined) => (valor == null || valor === "" ? "" : `<${nome}>${textoXml(valor)}</${nome}>`);

// -----------------------------------------------------------------------------
// Dados da DPS
// -----------------------------------------------------------------------------

export interface EnderecoNacional {
  logradouro: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  codigoMunicipio: string;
  cep: string;
}

export interface DadosDps {
  ambiente: AmbienteNfse;
  emitidaEm: Date;
  serie: number;
  numero: number;
  /** AAAA-MM-DD: data em que o serviço foi prestado */
  competencia: string;
  codigoMunicipioEmissor: string;
  prestador: {
    cnpj: string;
    inscricaoMunicipal: string | null;
    /** 1 = não optante; 2 = MEI; 3 = Simples ME/EPP */
    opcaoSimples: 1 | 2 | 3;
    regimeApuracaoSn: 1 | 2 | 3;
    regimeEspecial: number;
  };
  tomador:
    | { tipo: "cnpj"; documento: string; nome: string; endereco: EnderecoNacional; email: string | null; telefone: string | null }
    | { tipo: "cpf"; documento: string; nome: string; endereco: EnderecoNacional | null; email: string | null; telefone: string | null }
    | null;
  servico: {
    localPrestacao: string;
    codigoTributacaoNacional: string;
    codigoTributacaoMunicipal: string | null;
    codigoNbs: string | null;
    descricao: string;
  };
  valor: string;
  issRetido: boolean;
  aliquotaIss: string | null;
  tributosAproximados:
    | { tipo: "simples"; percentual: string }
    | { tipo: "percentuais"; federal: string; estadual: string; municipal: string }
    | { tipo: "nao_informar" };
  informacoesComplementares: string | null;
}

/** Data e hora no fuso de Tocantins (UTC−3, sem horário de verão), no formato do leiaute. */
export function dataHoraBrasil(d: Date): string {
  return `${new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 19)}-03:00`;
}

/** "DPS" + município (7) + tipo de inscrição (1 = CPF; 2 = CNPJ) + inscrição (14) + série (5) + número (15). */
export function idDps(codigoMunicipio: string, cnpj: string, serie: number, numero: number): string {
  const id = `DPS${codigoMunicipio}2${cnpj.padStart(14, "0")}${String(serie).padStart(5, "0")}${String(numero).padStart(15, "0")}`;
  if (!/^DPS[0-9]{42}$/.test(id)) throw new Error("Identificador da DPS inválido.");
  return id;
}

function endereco(e: EnderecoNacional): string {
  const cep = e.cep.replace(/\D/g, "");
  if (!/^[0-9]{7}$/.test(e.codigoMunicipio) || !/^[0-9]{8}$/.test(cep)) throw new Error("Endereço do tomador incompleto (município ou CEP).");
  return (
    `<end><endNac><cMun>${e.codigoMunicipio}</cMun><CEP>${cep}</CEP></endNac>` +
    txt("xLgr", textoLeiaute(e.logradouro, 255) || "Não informado") +
    txt("nro", textoLeiaute(e.numero ?? "", 60) || "S/N") +
    txt("xCpl", textoLeiaute(e.complemento ?? "", 156) || null) +
    txt("xBairro", textoLeiaute(e.bairro ?? "", 60) || "Não informado") +
    "</end>"
  );
}

/** Grupo infDPS (canônico, com o namespace declarado) e o seu identificador. */
export function montarInfDps(d: DadosDps): { id: string; canonico: string; filhos: string } {
  const p = d.prestador;
  if (!/^[0-9]{14}$/.test(p.cnpj)) throw new Error("CNPJ do prestador inválido.");
  const id = idDps(d.codigoMunicipioEmissor, p.cnpj, d.serie, d.numero);

  const regTrib =
    `<regTrib><opSimpNac>${p.opcaoSimples}</opSimpNac>` +
    (p.opcaoSimples === 3 ? `<regApTribSN>${p.regimeApuracaoSn}</regApTribSN>` : "") +
    `<regEspTrib>${p.opcaoSimples === 2 || (p.opcaoSimples === 3 && p.regimeApuracaoSn === 1) ? 0 : p.regimeEspecial}</regEspTrib></regTrib>`;
  const prest = `<prest><CNPJ>${p.cnpj}</CNPJ>${txt("IM", p.inscricaoMunicipal ? textoLeiaute(p.inscricaoMunicipal, 15) : null)}${regTrib}</prest>`;

  let toma = "";
  const t = d.tomador;
  if (t) {
    const doc = t.tipo === "cnpj" ? `<CNPJ>${t.documento}</CNPJ>` : `<CPF>${t.documento}</CPF>`;
    toma =
      `<toma>${doc}${txt("xNome", textoLeiaute(t.nome, 300))}` +
      (t.endereco ? endereco(t.endereco) : "") +
      txt("fone", t.telefone && /^[0-9]{6,20}$/.test(t.telefone) ? t.telefone : null) +
      txt("email", t.email ? textoLeiaute(t.email, 80) : null) +
      "</toma>";
  }

  const s = d.servico;
  const descricao = textoLeiaute(s.descricao, 1000, { quebras: true });
  if (descricao.length < 1) throw new Error("Descrição do serviço vazia.");
  const serv =
    `<serv><locPrest><cLocPrestacao>${s.localPrestacao}</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>${s.codigoTributacaoNacional}</cTribNac>${el("cTribMun", s.codigoTributacaoMunicipal)}` +
    `${txt("xDescServ", descricao)}${el("cNBS", s.codigoNbs)}</cServ>` +
    (d.informacoesComplementares ? `<infoCompl>${txt("xInfComp", textoLeiaute(d.informacoesComplementares, 2000))}</infoCompl>` : "") +
    "</serv>";

  // Alíquota do ISS: Simples ME/EPP com ISS pelo SN informa só quando há retenção (regras E0625 a E0631)
  const informaAliquota = d.issRetido && p.opcaoSimples === 3 && p.regimeApuracaoSn === 1;
  if (informaAliquota && !d.aliquotaIss) throw new Error("Falta a alíquota do ISS retido.");
  const tribMun =
    `<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${d.issRetido ? 2 : 1}</tpRetISSQN>` +
    (informaAliquota ? `<pAliq>${decimal(d.aliquotaIss!, 1)}</pAliq>` : "") +
    "</tribMun>";
  const ta = d.tributosAproximados;
  const totTrib =
    ta.tipo === "simples"
      ? `<totTrib><pTotTribSN>${decimal(ta.percentual, 2)}</pTotTribSN></totTrib>`
      : ta.tipo === "percentuais"
        ? `<totTrib><pTotTrib><pTotTribFed>${decimal(ta.federal, 3)}</pTotTribFed><pTotTribEst>${decimal(ta.estadual, 3)}</pTotTribEst>` +
          `<pTotTribMun>${decimal(ta.municipal, 3)}</pTotTribMun></pTotTrib></totTrib>`
        : "<totTrib><indTotTrib>0</indTotTrib></totTrib>";
  const valores = `<valores><vServPrest><vServ>${decimal(d.valor, 15)}</vServ></vServPrest><trib>${tribMun}${totTrib}</trib></valores>`;

  const filhos =
    `<tpAmb>${d.ambiente === "producao" ? 1 : 2}</tpAmb><dhEmi>${dataHoraBrasil(d.emitidaEm)}</dhEmi>` +
    `<verAplic>${VERSAO_APLICATIVO}</verAplic><serie>${d.serie}</serie><nDPS>${d.numero}</nDPS><dCompet>${d.competencia}</dCompet>` +
    `<tpEmit>1</tpEmit><cLocEmi>${d.codigoMunicipioEmissor}</cLocEmi>${prest}${toma}${serv}${valores}`;
  return { id, filhos, canonico: `<infDPS xmlns="${NS_NFSE}" Id="${id}">${filhos}</infDPS>` };
}

// -----------------------------------------------------------------------------
// Assinatura
// -----------------------------------------------------------------------------

export interface ChavesAssinatura {
  chavePem: string;
  certificadoPem: string;
}

/** Signature (XMLDSig, envelopada) do elemento canônico `canonico` com o Id `id`. */
export function assinatura(canonico: string, id: string, chaves: ChavesAssinatura): string {
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
  const valor = sign("sha1", Buffer.from(signedInfo, "utf8"), createPrivateKey(chaves.chavePem)).toString("base64");
  const certificado = new X509Certificate(chaves.certificadoPem).raw.toString("base64");
  return (
    `<Signature xmlns="${NS_DSIG}">${signedInfo.replace(` xmlns="${NS_DSIG}"`, "")}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificado}</X509Certificate></X509Data></KeyInfo></Signature>`
  );
}

/** DPS completa e assinada, pronta para compactar e enviar. */
export function dpsAssinada(d: DadosDps, chaves: ChavesAssinatura): { id: string; xml: string } {
  const inf = montarInfDps(d);
  return {
    id: inf.id,
    xml: `<DPS xmlns="${NS_NFSE}" versao="${VERSAO_LEIAUTE}"><infDPS Id="${inf.id}">${inf.filhos}</infDPS>${assinatura(inf.canonico, inf.id, chaves)}</DPS>`,
  };
}

// -----------------------------------------------------------------------------
// Cancelamento (pedido de registro do evento 101101)
// -----------------------------------------------------------------------------

export const MOTIVOS_CANCELAMENTO = {
  1: "Erro na emissão",
  2: "Serviço não prestado",
  9: "Outros",
} as const;
export type MotivoCancelamento = keyof typeof MOTIVOS_CANCELAMENTO;

export function pedidoCancelamentoAssinado(
  p: { ambiente: AmbienteNfse; chave: string; cnpj: string; quando: Date; motivo: MotivoCancelamento; justificativa: string },
  chaves: ChavesAssinatura,
): { id: string; xml: string } {
  if (!/^[0-9]{50}$/.test(p.chave)) throw new Error("Chave de acesso da NFS-e inválida.");
  if (!/^[0-9]{14}$/.test(p.cnpj)) throw new Error("CNPJ do autor inválido.");
  const justificativa = textoLeiaute(p.justificativa, 255);
  if (justificativa.length < 15) throw new Error("A justificativa do cancelamento precisa ter ao menos 15 caracteres.");
  const id = `PRE${p.chave}101101`;
  const filhos =
    `<tpAmb>${p.ambiente === "producao" ? 1 : 2}</tpAmb><verAplic>${VERSAO_APLICATIVO}</verAplic><dhEvento>${dataHoraBrasil(p.quando)}</dhEvento>` +
    `<CNPJAutor>${p.cnpj}</CNPJAutor><chNFSe>${p.chave}</chNFSe>` +
    `<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>${p.motivo}</cMotivo><xMotivo>${textoXml(justificativa)}</xMotivo></e101101>`;
  const canonico = `<infPedReg xmlns="${NS_NFSE}" Id="${id}">${filhos}</infPedReg>`;
  return {
    id,
    xml: `<pedRegEvento xmlns="${NS_NFSE}" versao="${VERSAO_LEIAUTE}"><infPedReg Id="${id}">${filhos}</infPedReg>${assinatura(canonico, id, chaves)}</pedRegEvento>`,
  };
}
