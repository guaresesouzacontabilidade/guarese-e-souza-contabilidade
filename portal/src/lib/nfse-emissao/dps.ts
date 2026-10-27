import { assinatura, textoLeiaute, textoXml, type ChavesAssinatura } from "@/lib/fiscal/xml-assinatura";

export { assinatura, textoLeiaute, textoXml, type ChavesAssinatura };

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
 *  - no leiaute 1.01 atual de produção, o grupo de IBS/CBS é opcional: não é
 *    enviado.
 *
 * Leiaute da NT 009 v1.01 (Anexo VI v1.04.01, de 01/10/2026; publicado só
 * como planilha, sem XSD): o governo implanta em etapas — a produção restrita
 * já exige a finalidade (finNFSe) no infDPS e o grupo IBSCBS com o CST e o
 * cClassTrib direto no trib, mas ainda recusa os campos do Simples
 * (regApIBSCBSSN, cAtvSN); depois vêm o indDest na raiz e a nova ordem do
 * cServ. Por isso o leiaute é uma combinação de partes (VarianteLeiaute), com
 * um padrão por ambiente, e o emissor ajusta a combinação pela mensagem de
 * recusa do esquema (ajustarVariante) e envia de novo a mesma DPS.
 */

export const NS_NFSE = "http://www.sped.fazenda.gov.br/nfse";
export const VERSAO_LEIAUTE = "1.01";
export const VERSAO_APLICATIVO = "PortalGuaresesON-1.0";

export type AmbienteNfse = "producao" | "homologacao";

/** Partes da NT 009 v1.01 usadas na DPS (todas falsas = leiaute 1.01 dos esquemas de 09/02/2026). */
export interface VarianteLeiaute {
  /** 2.2: finNFSe no infDPS, logo depois do tpEmit */
  finNFSe: boolean;
  /** Grupo IBSCBS (obrigatório na NT 009 para competência a partir de 01/10/2026, E0855), com o NBS (E0322) */
  ibscbs: boolean;
  /** 2.4: regApIBSCBSSN e cAtvSN para o Simples ME/EPP */
  simples: boolean;
  /** Ordem do cServ da NT 009: NBS (e cAtvSN) antes da descrição */
  cServNovaOrdem: boolean;
  /** 2.11: indDest no infDPS, depois do tomador (antes: dentro do IBSCBS) */
  indDestNaRaiz: boolean;
  /** 2.16: CST e cClassTrib direto no trib, antes do gIBSCBS (antes: dentro do gIBSCBS) */
  cstNoTrib: boolean;
}

export const LEIAUTE_1_01: VarianteLeiaute = { finNFSe: false, ibscbs: false, simples: false, cServNovaOrdem: false, indDestNaRaiz: false, cstNoTrib: false };
export const LEIAUTE_NT009: VarianteLeiaute = { finNFSe: true, ibscbs: true, simples: true, cServNovaOrdem: true, indDestNaRaiz: true, cstNoTrib: true };

/** Ponto de partida de cada ambiente (o emissor guarda o que aprender com as recusas). */
export const VARIANTE_PADRAO: Record<AmbienteNfse, VarianteLeiaute> = {
  producao: LEIAUTE_1_01,
  // Produção restrita em 20/10/2026: finNFSe e CST no trib já valem; Simples (2.4) e indDest na raiz ainda não.
  // Em 27/10/2026 recusou o NBS depois da descrição: a nova ordem do cServ já vale
  homologacao: { finNFSe: true, ibscbs: true, simples: false, cServNovaOrdem: true, indDestNaRaiz: false, cstNoTrib: true },
};

/**
 * A partir da recusa do Sistema Nacional, a combinação de partes do leiaute
 * que corrige o problema (ou null quando a recusa não é de leiaute). Lê a
 * mensagem do validador de esquema (E1235: "The element 'X' has invalid child
 * element 'Y'. List of possible elements expected: 'Z'") e as regras de
 * obrigatoriedade do grupo IBSCBS e dos campos do Simples.
 */
export function ajustarVariante(v: VarianteLeiaute, erros: { codigo: string; descricao: string; complemento?: string | null }[]): VarianteLeiaute | null {
  const com = (mudanca: Partial<VarianteLeiaute>) => {
    const nova = { ...v, ...mudanca };
    return (Object.keys(mudanca) as (keyof VarianteLeiaute)[]).some((k) => nova[k] !== v[k]) ? nova : null;
  };
  for (const e of erros) {
    const texto = `${e.descricao ?? ""} ${e.complemento ?? ""}`;
    const lista = texto.split("List of possible elements expected:")[1] ?? "";
    const esperados = [...lista.matchAll(/'([^']*)'/g)]
      .map((m) => m[1])
      .filter((x) => !x.startsWith("http"))
      .flatMap((x) => x.split(/,\s*/))
      .filter(Boolean);
    const filhoInvalido = /The element '(\w+)'(?: in namespace '[^']*')? has invalid child element '(\w+)'/.exec(texto);
    const incompleto = /The element '(\w+)'(?: in namespace '[^']*')? has incomplete content/.exec(texto);
    let r: VarianteLeiaute | null = null;
    if (filhoInvalido) {
      const [, pai, filho] = filhoInvalido;
      if (filho === "regApIBSCBSSN" || filho === "cAtvSN") r = com({ simples: false });
      else if (pai === "regTrib" && esperados.includes("regApIBSCBSSN")) r = com({ simples: true });
      else if (pai === "cServ" && esperados.includes("cAtvSN")) r = com({ simples: true });
      else if (pai === "infDPS" && esperados.includes("finNFSe")) r = com({ finNFSe: true });
      else if (pai === "infDPS" && filho === "finNFSe") r = com({ finNFSe: false });
      else if (pai === "infDPS" && esperados.includes("indDest")) r = com({ indDestNaRaiz: true });
      else if (pai === "infDPS" && filho === "indDest") r = com({ indDestNaRaiz: false });
      else if (pai === "IBSCBS" && esperados.includes("indDest")) r = com({ indDestNaRaiz: false });
      else if (pai === "IBSCBS" && filho === "indDest") r = com({ indDestNaRaiz: true });
      else if (pai === "cServ" && filho === "cNBS" && esperados.includes("xDescServ")) r = com({ cServNovaOrdem: false });
      // Nada esperado depois da descrição: na nova ordem ela é o último campo do cServ
      else if (pai === "cServ" && ["cNBS", "cAtvSN", "cIntContrib"].includes(filho) && !esperados.length) r = com({ cServNovaOrdem: true });
      else if (pai === "cServ" && filho === "xDescServ" && esperados.some((x) => ["cNBS", "cAtvSN", "cIntContrib"].includes(x))) r = com({ cServNovaOrdem: true });
      else if (pai === "trib" && filho === "CST") r = com({ cstNoTrib: false });
      else if (pai === "trib" && filho === "gIBSCBS" && esperados.includes("CST")) r = com({ cstNoTrib: true });
      else if (pai === "gIBSCBS" && esperados.includes("CST")) r = com({ cstNoTrib: false });
      else if (pai === "infDPS" && filho === "IBSCBS") r = com({ ibscbs: false });
    } else if (incompleto) {
      const [, pai] = incompleto;
      if (pai === "IBSCBS" && esperados.includes("indDest")) r = com({ indDestNaRaiz: false });
      else if (pai === "infDPS" && esperados.includes("indDest")) r = com({ indDestNaRaiz: true });
      else if (pai === "infDPS" && esperados.includes("finNFSe")) r = com({ finNFSe: true });
      else if (pai === "gIBSCBS" && esperados.includes("CST")) r = com({ cstNoTrib: false });
      else if (pai === "trib" && esperados.includes("CST")) r = com({ cstNoTrib: true });
      else if (pai === "regTrib" && esperados.includes("regApIBSCBSSN")) r = com({ simples: true });
    } else if (e.codigo === "E0855") {
      r = com({ ibscbs: true });
    } else if (/obrigat/i.test(texto) && /(regApIBSCBSSN|cAtvSN|atividade do Simples Nacional|apuração tributária pelo Simples Nacional para IBS)/i.test(texto)) {
      r = com({ simples: true });
    }
    if (r) return r;
  }
  return null;
}

/** CST do IBS/CBS sem tributação na nota (isenção, imunidade, declaração em regime específico): sem cIndOp nem gIBSCBS. */
const CST_SEM_TRIBUTACAO = new Set(["400", "410", "820"]);

// -----------------------------------------------------------------------------
// Texto
// -----------------------------------------------------------------------------

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
  /** Partes da NT 009 usadas (sem ela, o padrão do ambiente) */
  variante?: VarianteLeiaute;
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
    /** NT 009: atividade do Simples Nacional (cAtvSN), obrigatória para ME/EPP */
    atividadeSimples?: number | null;
    /** NT 009: indicador da operação (cIndOp) e classificação tributária (cClassTrib) do IBS/CBS */
    ibscbs?: { indicadorOperacao: string; classificacao: string } | null;
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
  const v = d.variante ?? VARIANTE_PADRAO[d.ambiente];
  const simplesNt009 = v.simples && p.opcaoSimples === 3;

  const regTrib =
    `<regTrib><opSimpNac>${p.opcaoSimples}</opSimpNac>` +
    (p.opcaoSimples === 3 ? `<regApTribSN>${p.regimeApuracaoSn}</regApTribSN>` : "") +
    // NT 009: IBS e CBS apurados pelo Simples (a opção pelo regime regular só existe a partir de 2027)
    (simplesNt009 ? "<regApIBSCBSSN>1</regApIBSCBSSN>" : "") +
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
  // Com o grupo IBSCBS, o NBS é obrigatório (E0322); com os campos do Simples, a atividade (cAtvSN)
  if (v.ibscbs && !s.codigoNbs) throw new Error("Falta o código NBS do serviço (obrigatório no leiaute novo da NFS-e). Ajuste o serviço em Configurar emissão.");
  if (simplesNt009 && !s.atividadeSimples) throw new Error("Falta a atividade do Simples Nacional do serviço (obrigatória no leiaute novo da NFS-e).");
  const nbs = el("cNBS", s.codigoNbs);
  const atvSn = simplesNt009 ? `<cAtvSN>${String(s.atividadeSimples).padStart(2, "0")}</cAtvSN>` : "";
  const cServ =
    `<cServ><cTribNac>${s.codigoTributacaoNacional}</cTribNac>${el("cTribMun", s.codigoTributacaoMunicipal)}` +
    (v.cServNovaOrdem ? `${nbs}${atvSn}${txt("xDescServ", descricao)}` : `${txt("xDescServ", descricao)}${nbs}${atvSn}`) +
    "</cServ>";
  const serv =
    `<serv><locPrest><cLocPrestacao>${s.localPrestacao}</cLocPrestacao></locPrest>${cServ}` +
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

  // Grupo do IBS/CBS (os valores são calculados pelo Sistema Nacional a partir da classificação)
  let ibscbs = "";
  if (v.ibscbs) {
    const ib = s.ibscbs;
    if (!ib || !/^[0-9]{6}$/.test(ib.classificacao) || !/^[0-9]{6}$/.test(ib.indicadorOperacao)) {
      throw new Error("Falta a classificação do IBS/CBS do serviço (obrigatória no leiaute novo da NFS-e). Ajuste o serviço em Configurar emissão.");
    }
    const cst = ib.classificacao.slice(0, 3);
    const classificacao = `<CST>${cst}</CST><cClassTrib>${ib.classificacao}</cClassTrib>`;
    let indOp: string;
    let trib: string;
    if (v.cstNoTrib) {
      // NT 009: sem tributação na nota (CST 400, 410, 820), sem indicador da operação nem gIBSCBS
      const tributado = !CST_SEM_TRIBUTACAO.has(cst);
      indOp = tributado ? `<cIndOp>${ib.indicadorOperacao}</cIndOp>` : "";
      trib = `${classificacao}${tributado ? "<gIBSCBS></gIBSCBS>" : ""}`;
    } else {
      indOp = `<cIndOp>${ib.indicadorOperacao}</cIndOp>`;
      trib = `<gIBSCBS>${classificacao}</gIBSCBS>`;
    }
    ibscbs = `<IBSCBS>${indOp}${v.indDestNaRaiz ? "" : "<indDest>0</indDest>"}<valores><trib>${trib}</trib></valores></IBSCBS>`;
  }

  const filhos =
    `<tpAmb>${d.ambiente === "producao" ? 1 : 2}</tpAmb><dhEmi>${dataHoraBrasil(d.emitidaEm)}</dhEmi>` +
    `<verAplic>${VERSAO_APLICATIVO}</verAplic><serie>${d.serie}</serie><nDPS>${d.numero}</nDPS><dCompet>${d.competencia}</dCompet>` +
    `<tpEmit>1</tpEmit>${v.finNFSe ? "<finNFSe>0</finNFSe>" : ""}<cLocEmi>${d.codigoMunicipioEmissor}</cLocEmi>${prest}${toma}` +
    // O destinatário é o próprio tomador
    `${v.ibscbs && v.indDestNaRaiz ? "<indDest>0</indDest>" : ""}${serv}${valores}${ibscbs}`;
  return { id, filhos, canonico: `<infDPS xmlns="${NS_NFSE}" Id="${id}">${filhos}</infDPS>` };
}

// -----------------------------------------------------------------------------
// Assinatura
// -----------------------------------------------------------------------------

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

/** 1 = erro na emissão; 2 = serviço não prestado; 9 = outros */
export type MotivoCancelamento = 1 | 2 | 9;

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
