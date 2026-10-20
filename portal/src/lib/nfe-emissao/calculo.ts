import { aliquotaInterestadual, ORIGENS_IMPORTADAS } from "@/lib/fiscal/icms-estados";
import { arredondar, dec, dividir, fmt, maior, multiplicar, percentual, ratear, somar, type Dec } from "./decimal";

/**
 * Cálculo da NF-e (modelo 55, leiaute 4.00): valores de cada item e da nota,
 * do jeito que vão para o XML, e as guias que a nota gera.
 *
 * As escolhas fiscais (CFOP, CST/CSOSN, alíquotas, classificação do IBS/CBS,
 * recolhimento por operação, contribuições estaduais) vêm da "operação"
 * cadastrada pelo escritório; aqui só se fazem as contas, com as fórmulas do
 * Manual de Orientação do Contribuinte e da NT 2025.002-RTC v1.52:
 *  - ICMS próprio: base = produtos + frete + seguro + outras − desconto, com
 *    a redução de base (CST 20, 51, 70, 90) e o diferimento (CST 51);
 *  - DIFAL (EC 87/2015 e LC 190/2022), venda a não contribuinte de outro
 *    estado: grupo ICMSUFDest, base única ou base dupla, com o FCP do destino;
 *  - PIS e COFINS: base da receita, sem o ICMS quando a operação mandar
 *    excluir (STF, Tema 69);
 *  - IBS e CBS (regra UB16-10): base = produtos + frete + seguro + outras −
 *    desconto − PIS − COFINS − ICMS − DIFAL − FCP; alíquotas de teste de 2026
 *    (IBS da UF 0,1%, IBS do município 0%, CBS 0,9%), com a redução do
 *    cClassTrib (pAliqEfet com 4 casas) e o diferimento quando o CST exige;
 *  - ICMS do frete retido pelo remetente (grupo retTransp), quando o
 *    transporte é contratado de autônomo ou de transportadora que não recolhe;
 *  - FUNRURAL e contribuições estaduais (FETHAB e outras) com os percentuais
 *    e valores cadastrados pelo escritório (mudam com a lei e a UPF).
 */

export type AmbienteNfe = "producao" | "homologacao";

export interface EnderecoNfe {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  codigoMunicipio: string;
  municipio: string;
  uf: string;
  cep?: string | null;
  telefone?: string | null;
  /** Só para destinatário no exterior (tabela do Bacen) */
  codigoPais?: string | null;
  pais?: string | null;
}

export interface EmitenteNfe {
  tipo: "cnpj" | "cpf";
  documento: string;
  nome: string;
  fantasia?: string | null;
  endereco: EnderecoNfe;
  inscricaoEstadual: string;
  /** 1 = Simples Nacional; 2 = Simples com excesso de sublimite; 3 = regime normal; 4 = MEI */
  crt: 1 | 2 | 3 | 4;
}

export interface DestinatarioNfe {
  tipo: "cnpj" | "cpf" | "estrangeiro";
  /** CNPJ, CPF ou identificação do estrangeiro (pode ser vazia) */
  documento: string | null;
  nome: string;
  endereco: EnderecoNfe;
  /** 1 = contribuinte do ICMS; 2 = contribuinte isento; 9 = não contribuinte */
  indicadorIe: 1 | 2 | 9;
  inscricaoEstadual?: string | null;
  email?: string | null;
}

/** ICMS do item (regime normal: CST; Simples Nacional: CSOSN). Percentuais em %. */
export interface RegraIcms {
  cst: string;
  aliquota?: number | null;
  /** Redução da base de cálculo (pRedBC) */
  reducaoBase?: number | null;
  /** Diferimento (pDif, CST 51) */
  diferimento?: number | null;
  /** Crédito do Simples (pCredSN, CSOSN 101) */
  creditoSimples?: number | null;
  /** Código de benefício fiscal da UF (cBenef), quando a UF exige */
  beneficio?: string | null;
}

export interface RegraPisCofins {
  cst: string;
  aliquota?: number | null;
}

export interface RegraIbsCbs {
  cst: string;
  classificacao: string;
  /** Redução de alíquota do cClassTrib (tabela oficial), em % */
  reducaoIbs: number;
  reducaoCbs: number;
  /** Percentual do diferimento (CST 510 e 515) */
  diferimento?: number | null;
}

export interface ItemEntrada {
  codigo: string;
  descricao: string;
  ncm: string;
  cest?: string | null;
  gtin?: string | null;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  /** Peso de uma unidade em kg (volumes, FETHAB por tonelada) */
  pesoKgUnidade?: string | null;
  /** Origem da mercadoria (tabela A do CST): 0 nacional; 1, 2, 3 e 8 com importação... */
  origem: string;
  icms: RegraIcms;
  pis: RegraPisCofins;
  cofins: RegraPisCofins;
  ibscbs: RegraIbsCbs | null;
  /** Excluir o ICMS da base do PIS e da COFINS */
  excluirIcmsPisCofins?: boolean;
  informacoes?: string | null;
}

export interface ContribuicaoEstadual {
  nome: string;
  /** upf_por_tonelada: % da UPF por tonelada; valor_por_tonelada: R$ por tonelada; percentual_valor: % do valor dos produtos */
  tipo: "upf_por_tonelada" | "valor_por_tonelada" | "percentual_valor";
  valor: number;
  /** Valor da UPF (R$), para o tipo upf_por_tonelada */
  valorUpf?: number | null;
  /** Começo do NCM dos produtos em que incide (vazio = todos) */
  ncms?: string[];
  codigoReceita?: string | null;
}

export interface TransportadorNfe {
  tipo: "cnpj" | "cpf";
  documento: string;
  nome: string;
  inscricaoEstadual?: string | null;
  endereco?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

export interface EntradaNfe {
  ambiente: AmbienteNfe;
  emitidaEm: Date;
  saidaEm?: Date | null;
  serie: number;
  numero: number;
  /** cNF: 8 dígitos sorteados na reserva do número */
  codigoNumerico: string;
  natureza: string;
  /** 1 = normal; 2 = complementar; 3 = ajuste; 4 = devolução */
  finalidade: 1 | 2 | 3 | 4;
  consumidorFinal: boolean;
  /** indPres: 0 não se aplica; 1 presencial; 2 internet; 3 teleatendimento; 4 entrega em domicílio; 5 presencial fora; 9 outros */
  presenca: 0 | 1 | 2 | 3 | 4 | 5 | 9;
  referencias?: string[];
  emitente: EmitenteNfe;
  destinatario: DestinatarioNfe;
  itens: ItemEntrada[];
  /** Frete, seguro, outras despesas e desconto da nota (rateados pelos itens) */
  frete?: string | null;
  seguro?: string | null;
  outras?: string | null;
  desconto?: string | null;
  transporte: {
    /** 0 remetente (CIF); 1 destinatário (FOB); 2 terceiros; 3 próprio do remetente; 4 próprio do destinatário; 9 sem frete */
    modalidade: 0 | 1 | 2 | 3 | 4 | 9;
    transportador?: TransportadorNfe | null;
    veiculo?: { placa: string; uf?: string | null; rntc?: string | null } | null;
    volumes?: { quantidade?: number | null; especie?: string | null; marca?: string | null } | null;
    /** ICMS do frete retido pelo remetente (autônomo ou transportadora que não recolhe) */
    icmsFrete?: { valorServico: string; reducaoBase?: number | null; aliquota: number; cfop: string; codigoMunicipio: string } | null;
  };
  pagamento: {
    /** tPag: 01 dinheiro, 03 cartão de crédito, 15 boleto, 17 PIX, 90 sem pagamento, 99 outros... */
    forma: string;
    descricao?: string | null;
    aPrazo: boolean;
    parcelas?: { vencimento: string; valor: string }[];
  };
  /** DIFAL para não contribuinte de outro estado: alíquota interna e FCP do destino */
  difal?: { metodo: "base_unica" | "base_dupla"; aliquotaInterna: number; fcp: number } | null;
  funrural?: { percentual: number; modo: "retido_adquirente" | "recolhido_produtor" } | null;
  contribuicoes?: ContribuicaoEstadual[];
  /** O ICMS próprio é pago a cada operação (antes da saída), e não na apuração do mês */
  icmsPorOperacao?: boolean;
  informacoesComplementares?: string | null;
  informacoesFisco?: string | null;
  responsavelTecnico?: { cnpj: string; contato: string; email: string; telefone: string } | null;
  autorizadosXml?: string[];
  pedidoCompra?: string | null;
}

export interface IcmsCalculado {
  cst: string;
  simples: boolean;
  modBC: string | null;
  vBC: Dec;
  pRedBC: Dec | null;
  pICMS: Dec | null;
  vICMSOp: Dec;
  pDif: Dec | null;
  vICMSDif: Dec;
  vICMS: Dec;
  pCredSN: Dec | null;
  vCredICMSSN: Dec;
  /** O grupo traz base e alíquota (CST 90/900 sem alíquota não traz) */
  comBase: boolean;
}

export interface DifalCalculado {
  vBCUFDest: Dec;
  pFCPUFDest: Dec;
  vFCPUFDest: Dec;
  pICMSUFDest: Dec;
  pICMSInter: Dec;
  vICMSUFDest: Dec;
}

export interface PisCofinsCalculado {
  cst: string;
  grupo: "Aliq" | "NT" | "Outr";
  vBC: Dec;
  aliquota: Dec;
  valor: Dec;
}

export interface GrupoIbsCalculado {
  pAliq: Dec;
  pRed: Dec | null;
  pAliqEfet: Dec | null;
  pDif: Dec | null;
  vDif: Dec;
  valor: Dec;
}

export interface IbsCbsCalculado {
  cst: string;
  classificacao: string;
  comValores: boolean;
  vBC: Dec;
  uf: GrupoIbsCalculado;
  mun: GrupoIbsCalculado;
  cbs: GrupoIbsCalculado;
  vIBS: Dec;
}

export interface ItemCalculado {
  entrada: ItemEntrada;
  numero: number;
  quantidade: Dec;
  valorUnitario: Dec;
  vProd: Dec;
  vFrete: Dec;
  vSeg: Dec;
  vOutro: Dec;
  vDesc: Dec;
  icms: IcmsCalculado;
  difal: DifalCalculado | null;
  pis: PisCofinsCalculado;
  cofins: PisCofinsCalculado;
  ibscbs: IbsCbsCalculado | null;
  vItem: Dec;
  pesoKg: Dec | null;
}

export interface TotaisNfe {
  vBC: Dec;
  vICMS: Dec;
  vICMSDeson: Dec;
  vFCPUFDest: Dec;
  vICMSUFDest: Dec;
  vICMSUFRemet: Dec;
  vFCP: Dec;
  vBCST: Dec;
  vST: Dec;
  vFCPST: Dec;
  vFCPSTRet: Dec;
  vProd: Dec;
  vFrete: Dec;
  vSeg: Dec;
  vDesc: Dec;
  vII: Dec;
  vIPI: Dec;
  vIPIDevol: Dec;
  vPIS: Dec;
  vCOFINS: Dec;
  vOutro: Dec;
  vNF: Dec;
  ibscbs: {
    vBC: Dec;
    vDifUF: Dec;
    vIBSUF: Dec;
    vDifMun: Dec;
    vIBSMun: Dec;
    vIBS: Dec;
    vDifCBS: Dec;
    vCBS: Dec;
  } | null;
  vNFTot: Dec | null;
}

export type TipoGuia = "icms_operacao" | "icms_frete" | "difal" | "fcp_difal" | "contribuicao";

export interface GuiaCalculada {
  tipo: TipoGuia;
  descricao: string;
  uf: string;
  valor: Dec;
  codigoReceita: string | null;
}

export interface NotaCalculada {
  entrada: EntradaNfe;
  /** 1 interna; 2 interestadual; 3 com o exterior */
  idDest: 1 | 2 | 3;
  consumidorFinal: boolean;
  itens: ItemCalculado[];
  totais: TotaisNfe;
  icmsFrete: { vServ: Dec; vBCRet: Dec; pICMSRet: Dec; vICMSRet: Dec; cfop: string; codigoMunicipio: string } | null;
  pesoLiquidoKg: Dec | null;
  funrural: { base: Dec; percentual: Dec; valor: Dec; modo: "retido_adquirente" | "recolhido_produtor" } | null;
  contribuicoes: { nome: string; valor: Dec; codigoReceita: string | null }[];
  guias: GuiaCalculada[];
  /** Textos automáticos das informações complementares (FUNRURAL, frete, contribuições...) */
  textosAutomaticos: string[];
}

// -----------------------------------------------------------------------------
// Tabelas
// -----------------------------------------------------------------------------

/** Indicadores dos CST do IBS/CBS (tabela oficial "CST", versão de 01/09/2026). */
export const CST_IBSCBS: Record<string, { descricao: string; valores: boolean; reducao: boolean; diferimento: boolean }> = {
  "000": { descricao: "Tributação integral", valores: true, reducao: false, diferimento: false },
  "010": { descricao: "Tributação com alíquotas uniformes", valores: true, reducao: false, diferimento: false },
  "011": { descricao: "Tributação com alíquotas uniformes reduzidas", valores: true, reducao: true, diferimento: false },
  "200": { descricao: "Alíquota reduzida", valores: true, reducao: true, diferimento: false },
  "400": { descricao: "Isenção", valores: false, reducao: false, diferimento: false },
  "410": { descricao: "Imunidade e não incidência", valores: false, reducao: false, diferimento: false },
  "510": { descricao: "Diferimento", valores: true, reducao: false, diferimento: true },
  "515": { descricao: "Diferimento com redução de alíquota", valores: true, reducao: true, diferimento: true },
  "550": { descricao: "Suspensão", valores: true, reducao: false, diferimento: false },
};

/** Alíquotas do IBS e da CBS por ano de emissão (LC 214/2025, arts. 343 e 344). */
export function aliquotasIbsCbs(ano: number): { uf: Dec; mun: Dec; cbs: Dec } {
  if (ano <= 2026) return { uf: dec("0.1"), mun: dec("0"), cbs: dec("0.9") };
  throw new Error(
    `As alíquotas do IBS e da CBS de ${ano} ainda não estão cadastradas no portal (dependem da alíquota de referência publicada pelo Senado). Fale com o escritório.`,
  );
}

/** CST do ICMS (regime normal) e CSOSN (Simples Nacional) aceitos na emissão pelo portal. */
export const CST_ICMS: Record<string, string> = {
  "00": "00 - Tributada integralmente",
  "20": "20 - Com redução da base de cálculo",
  "40": "40 - Isenta",
  "41": "41 - Não tributada",
  "50": "50 - Suspensão",
  "51": "51 - Diferimento",
  "90": "90 - Outras",
};
export const CSOSN: Record<string, string> = {
  "101": "101 - Tributada pelo Simples com permissão de crédito",
  "102": "102 - Tributada pelo Simples sem permissão de crédito",
  "103": "103 - Isenção do ICMS no Simples para faixa de receita bruta",
  "300": "300 - Imune",
  "400": "400 - Não tributada pelo Simples",
  "900": "900 - Outros",
};

/** Fuso de cada UF (sem horário de verão desde 2019). */
export function fusoDaUf(uf: string): string {
  const u = uf.toUpperCase();
  if (u === "AC") return "-05:00";
  if (["AM", "RO", "RR", "MT", "MS"].includes(u)) return "-04:00";
  return "-03:00";
}

/** Data e hora no fuso do emitente: "2026-10-20T15:30:00-04:00". */
export function dataHoraUf(d: Date, uf: string): string {
  const fuso = fusoDaUf(uf);
  const horas = Number(fuso.slice(0, 3));
  return `${new Date(d.getTime() + horas * 3600_000).toISOString().slice(0, 19)}${fuso}`;
}

const um = (v: Dec | null | undefined) => v ?? 0n;

function erro(msg: string): never {
  throw new Error(msg);
}

// -----------------------------------------------------------------------------
// Cálculo
// -----------------------------------------------------------------------------

function calcularIcms(regra: RegraIcms, base0: Dec, simples: boolean): IcmsCalculado {
  const cst = regra.cst;
  const r: IcmsCalculado = {
    cst,
    simples,
    modBC: null,
    vBC: 0n,
    pRedBC: null,
    pICMS: null,
    vICMSOp: 0n,
    pDif: null,
    vICMSDif: 0n,
    vICMS: 0n,
    pCredSN: null,
    vCredICMSSN: 0n,
    comBase: false,
  };
  const aliquota = regra.aliquota == null ? null : dec(regra.aliquota);
  const reducao = regra.reducaoBase ? dec(regra.reducaoBase) : null;
  const comBase = (exigeAliquota: boolean) => {
    if (aliquota == null) {
      if (exigeAliquota) erro(`Falta a alíquota do ICMS para o CST ${cst}.`);
      return;
    }
    r.modBC = "3";
    r.pRedBC = reducao;
    r.vBC = arredondar(reducao ? base0 - percentual(base0, reducao) : base0, 2);
    r.pICMS = aliquota;
    r.vICMS = arredondar(percentual(r.vBC, aliquota), 2);
    r.comBase = true;
  };

  if (simples) {
    if (!CSOSN[cst]) erro(`CSOSN ${cst} não aceito na emissão pelo portal.`);
    if (cst === "101") {
      if (regra.creditoSimples == null) erro("Falta o percentual de crédito do Simples (CSOSN 101).");
      r.pCredSN = dec(regra.creditoSimples);
      r.vCredICMSSN = arredondar(percentual(base0, r.pCredSN), 2);
    }
    if (cst === "900") comBase(false);
    return r;
  }

  if (!CST_ICMS[cst]) erro(`CST ${cst} do ICMS não aceito na emissão pelo portal.`);
  if (cst === "00") {
    if (reducao) erro("O CST 00 não tem redução de base: use o CST 20.");
    comBase(true);
  } else if (cst === "20") {
    if (!reducao) erro("Falta o percentual de redução da base (CST 20).");
    comBase(true);
  } else if (cst === "51") {
    comBase(true);
    r.vICMSOp = r.vICMS;
    r.pDif = dec(regra.diferimento ?? 100);
    r.vICMSDif = arredondar(percentual(r.vICMSOp, r.pDif), 2);
    r.vICMS = r.vICMSOp - r.vICMSDif;
  } else if (cst === "90") {
    comBase(false);
  }
  return r;
}

function calcularPisCofins(regra: RegraPisCofins, base: Dec, nome: string): PisCofinsCalculado {
  const cst = regra.cst.padStart(2, "0");
  if (["01", "02"].includes(cst)) {
    if (regra.aliquota == null) erro(`Falta a alíquota do ${nome} (CST ${cst}).`);
    const p = dec(regra.aliquota);
    return { cst, grupo: "Aliq", vBC: base, aliquota: p, valor: arredondar(percentual(base, p), 2) };
  }
  if (["04", "05", "06", "07", "08", "09"].includes(cst)) return { cst, grupo: "NT", vBC: 0n, aliquota: 0n, valor: 0n };
  const n = Number(cst);
  if ((n >= 49 && n <= 56) || (n >= 60 && n <= 67) || (n >= 70 && n <= 75) || n === 98 || n === 99) {
    const p = dec(regra.aliquota ?? 0);
    return { cst, grupo: "Outr", vBC: base, aliquota: p, valor: arredondar(percentual(base, p), 2) };
  }
  return erro(`CST ${cst} do ${nome} não aceito na emissão pelo portal.`);
}

function grupoIbs(vBC: Dec, aliquota: Dec, reducao: number | null, diferimento: number | null): GrupoIbsCalculado {
  const pRed = reducao == null ? null : dec(reducao);
  // NT 2025.002, regra UB28-10: alíquota efetiva com 4 casas
  const pAliqEfet = pRed == null ? null : arredondar(aliquota - percentual(aliquota, pRed), 4);
  const efetiva = pAliqEfet ?? aliquota;
  const bruto = arredondar(percentual(vBC, efetiva), 2);
  const pDif = diferimento == null ? null : dec(diferimento);
  const vDif = pDif == null ? 0n : arredondar(percentual(percentual(vBC, efetiva), pDif), 2);
  return { pAliq: aliquota, pRed, pAliqEfet, pDif, vDif, valor: bruto - vDif };
}

function calcularIbsCbs(regra: RegraIbsCbs, vBC: Dec, ano: number): IbsCbsCalculado {
  const cst = regra.cst;
  const ind = CST_IBSCBS[cst] ?? erro(`CST ${cst} do IBS/CBS não aceito na emissão pelo portal.`);
  if (!/^\d{6}$/.test(regra.classificacao) || regra.classificacao.slice(0, 3) !== cst) {
    erro(`Classificação tributária ${regra.classificacao} do IBS/CBS não corresponde ao CST ${cst}.`);
  }
  const vazio: GrupoIbsCalculado = { pAliq: 0n, pRed: null, pAliqEfet: null, pDif: null, vDif: 0n, valor: 0n };
  if (!ind.valores) return { cst, classificacao: regra.classificacao, comValores: false, vBC: 0n, uf: vazio, mun: vazio, cbs: vazio, vIBS: 0n };
  const al = aliquotasIbsCbs(ano);
  const dif = ind.diferimento ? (regra.diferimento ?? 100) : null;
  const uf = grupoIbs(vBC, al.uf, ind.reducao ? regra.reducaoIbs : null, dif);
  const mun = grupoIbs(vBC, al.mun, ind.reducao ? regra.reducaoIbs : null, dif);
  const cbs = grupoIbs(vBC, al.cbs, ind.reducao ? regra.reducaoCbs : null, dif);
  return { cst, classificacao: regra.classificacao, comValores: true, vBC, uf, mun, cbs, vIBS: uf.valor + mun.valor };
}

const MODALIDADES_FRETE = new Set([0, 1, 2, 3, 4, 9]);

export function calcularNota(e: EntradaNfe): NotaCalculada {
  if (!e.itens.length) erro("Inclua ao menos um produto.");
  if (e.itens.length > 990) erro("A NF-e aceita no máximo 990 itens.");
  if (!MODALIDADES_FRETE.has(e.transporte.modalidade)) erro("Modalidade do frete inválida.");
  const ufEmit = e.emitente.endereco.uf.toUpperCase();
  const ufDest = e.destinatario.endereco.uf.toUpperCase();
  const exterior = e.destinatario.tipo === "estrangeiro" || ufDest === "EX";
  const idDest: 1 | 2 | 3 = exterior ? 3 : ufEmit === ufDest ? 1 : 2;
  const simples = e.emitente.crt === 1 || e.emitente.crt === 4;
  // Rejeição 696: operação com não contribuinte deve indicar consumidor final
  const consumidorFinal = e.consumidorFinal || e.destinatario.indicadorIe === 9;
  const ano = Number(dataHoraUf(e.emitidaEm, ufEmit).slice(0, 4));
  const digitoCfop = idDest === 1 ? "5" : idDest === 2 ? "6" : "7";

  const quantidades = e.itens.map((i) => {
    const q = dec(i.quantidade);
    const v = dec(i.valorUnitario);
    if (q <= 0n) erro(`Quantidade inválida no produto ${i.descricao}.`);
    if (v < 0n) erro(`Valor unitário inválido no produto ${i.descricao}.`);
    return { q, v, vProd: arredondar(multiplicar(q, v), 2) };
  });
  const pesos = quantidades.map((x) => x.vProd);
  const fretes = ratear(dec(e.frete), pesos);
  const seguros = ratear(dec(e.seguro), pesos);
  const outras = ratear(dec(e.outras), pesos);
  const descontos = ratear(dec(e.desconto), pesos);

  const itens: ItemCalculado[] = e.itens.map((i, n) => {
    if (!/^\d{8}$/.test(i.ncm) && i.ncm !== "00") erro(`NCM inválido no produto ${i.descricao} (8 dígitos).`);
    if (!/^[1-7]\d{3}$/.test(i.cfop)) erro(`CFOP inválido no produto ${i.descricao}.`);
    if (i.cfop[0] !== digitoCfop) {
      const tipo = idDest === 1 ? "dentro do estado (5.xxx)" : idDest === 2 ? "para outro estado (6.xxx)" : "para o exterior (7.xxx)";
      erro(`O CFOP ${i.cfop} do produto ${i.descricao} não combina com a venda ${tipo}. Confira a operação escolhida.`);
    }
    const { q, v, vProd } = quantidades[n];
    const vFrete = fretes[n];
    const vSeg = seguros[n];
    const vOutro = outras[n];
    const vDesc = descontos[n];
    const base0 = vProd + vFrete + vSeg + vOutro - vDesc;
    if (base0 < 0n) erro(`O desconto é maior que o valor do produto ${i.descricao}.`);
    const icms = calcularIcms(i.icms, base0, simples);

    let difal: DifalCalculado | null = null;
    if (e.difal && idDest === 2 && consumidorFinal && e.destinatario.indicadorIe === 9) {
      const inter = aliquotaInterestadual(ufEmit, ufDest, ORIGENS_IMPORTADAS.has(i.origem)) ?? 12;
      const pInter = dec(inter);
      const pDest = dec(e.difal.aliquotaInterna);
      const pFcp = dec(e.difal.fcp);
      let vBCUFDest: Dec;
      let vICMSUFDest: Dec;
      if (e.difal.metodo === "base_dupla") {
        // LC 190/2022: o imposto do destino integra a própria base
        const icmsOrigem = arredondar(percentual(base0, pInter), 2);
        vBCUFDest = arredondar(dividir(base0 - icmsOrigem, dec(1) - dividir(pDest + pFcp, dec(100))), 2);
        vICMSUFDest = maior(0n, arredondar(percentual(vBCUFDest, pDest), 2) - icmsOrigem);
      } else {
        vBCUFDest = base0;
        vICMSUFDest = maior(0n, arredondar(percentual(base0, pDest - pInter), 2));
      }
      difal = {
        vBCUFDest,
        pFCPUFDest: pFcp,
        vFCPUFDest: arredondar(percentual(vBCUFDest, pFcp), 2),
        pICMSUFDest: pDest,
        pICMSInter: pInter,
        vICMSUFDest,
      };
    }

    const basePisCofins = maior(0n, base0 - (i.excluirIcmsPisCofins === false ? 0n : icms.vICMS));
    const pis = calcularPisCofins(i.pis, basePisCofins, "PIS");
    const cofins = calcularPisCofins(i.cofins, basePisCofins, "COFINS");

    let ibscbs: IbsCbsCalculado | null = null;
    if (i.ibscbs) {
      // Regra UB16-10 (sem II, IS, ISSQN e ICMS monofásico, que o portal não emite)
      const vBC = maior(0n, base0 - pis.valor - cofins.valor - icms.vICMS - um(difal?.vICMSUFDest) - um(difal?.vFCPUFDest));
      ibscbs = calcularIbsCbs(i.ibscbs, vBC, ano);
    }
    // vItem (regra VB01-10): em 2025 e 2026 sem somar IBS e CBS
    const vItem = vProd - vDesc + vFrete + vSeg + vOutro;
    const pesoKg = i.pesoKgUnidade ? multiplicar(q, dec(i.pesoKgUnidade)) : null;
    return { entrada: i, numero: n + 1, quantidade: q, valorUnitario: v, vProd, vFrete, vSeg, vOutro, vDesc, icms, difal, pis, cofins, ibscbs, vItem, pesoKg };
  });

  const soma = (f: (i: ItemCalculado) => Dec) => somar(...itens.map(f));
  const comIbs = itens.filter((i) => i.ibscbs);
  const totais: TotaisNfe = {
    vBC: soma((i) => i.icms.vBC),
    vICMS: soma((i) => i.icms.vICMS),
    vICMSDeson: 0n,
    vFCPUFDest: soma((i) => um(i.difal?.vFCPUFDest)),
    vICMSUFDest: soma((i) => um(i.difal?.vICMSUFDest)),
    vICMSUFRemet: 0n,
    vFCP: 0n,
    vBCST: 0n,
    vST: 0n,
    vFCPST: 0n,
    vFCPSTRet: 0n,
    vProd: soma((i) => i.vProd),
    vFrete: soma((i) => i.vFrete),
    vSeg: soma((i) => i.vSeg),
    vDesc: soma((i) => i.vDesc),
    vII: 0n,
    vIPI: 0n,
    vIPIDevol: 0n,
    vPIS: soma((i) => i.pis.valor),
    vCOFINS: soma((i) => i.cofins.valor),
    vOutro: soma((i) => i.vOutro),
    vNF: 0n,
    ibscbs: comIbs.length
      ? {
          vBC: soma((i) => um(i.ibscbs?.vBC)),
          vDifUF: soma((i) => um(i.ibscbs?.uf.vDif)),
          vIBSUF: soma((i) => um(i.ibscbs?.uf.valor)),
          vDifMun: soma((i) => um(i.ibscbs?.mun.vDif)),
          vIBSMun: soma((i) => um(i.ibscbs?.mun.valor)),
          vIBS: soma((i) => um(i.ibscbs?.vIBS)),
          vDifCBS: soma((i) => um(i.ibscbs?.cbs.vDif)),
          vCBS: soma((i) => um(i.ibscbs?.cbs.valor)),
        }
      : null,
    vNFTot: null,
  };
  // vNF (regra W16-10): produtos − desconto + ST + frete + seguro + outras + II + IPI
  totais.vNF = totais.vProd - totais.vDesc - totais.vICMSDeson + totais.vST + totais.vFCPST + totais.vFrete + totais.vSeg + totais.vOutro + totais.vII + totais.vIPI + totais.vIPIDevol;
  if (totais.ibscbs) totais.vNFTot = soma((i) => i.vItem);

  // ICMS do frete retido (retTransp)
  let icmsFrete: NotaCalculada["icmsFrete"] = null;
  const f = e.transporte.icmsFrete;
  if (f) {
    const vServ = arredondar(dec(f.valorServico), 2);
    if (vServ <= 0n) erro("Informe o valor do frete para calcular o ICMS do frete.");
    if (!/^[56]3[5-6]\d$/.test(f.cfop)) erro("CFOP do ICMS do frete inválido (prestação de serviço de transporte: 5.351 a 5.360 ou 6.351 a 6.360).");
    const red = f.reducaoBase ? dec(f.reducaoBase) : 0n;
    const vBCRet = arredondar(vServ - percentual(vServ, red), 2);
    const pICMSRet = dec(f.aliquota);
    icmsFrete = { vServ, vBCRet, pICMSRet, vICMSRet: arredondar(percentual(vBCRet, pICMSRet), 2), cfop: f.cfop, codigoMunicipio: f.codigoMunicipio };
  }

  const pesos2 = itens.map((i) => i.pesoKg);
  const pesoLiquidoKg = pesos2.every((p) => p != null) ? somar(...(pesos2 as Dec[])) : null;

  // FUNRURAL (informativo, nas informações complementares)
  let funrural: NotaCalculada["funrural"] = null;
  if (e.funrural && e.funrural.percentual > 0) {
    const base = totais.vProd - totais.vDesc;
    const p = dec(e.funrural.percentual);
    funrural = { base, percentual: p, valor: arredondar(percentual(base, p), 2), modo: e.funrural.modo };
  }

  // Contribuições estaduais (FETHAB e outras)
  const contribuicoes = (e.contribuicoes ?? []).map((c) => {
    const alvo = itens.filter((i) => !c.ncms?.length || c.ncms.some((p) => i.entrada.ncm.startsWith(p.replace(/\D/g, ""))));
    let valor = 0n;
    for (const i of alvo) {
      if (c.tipo === "percentual_valor") {
        valor += percentual(i.vProd - i.vDesc, dec(c.valor));
        continue;
      }
      if (i.pesoKg == null) erro(`Informe o peso por unidade (kg) do produto ${i.entrada.descricao} para calcular ${c.nome}.`);
      const toneladas = dividir(i.pesoKg, dec(1000));
      if (c.tipo === "valor_por_tonelada") valor += multiplicar(toneladas, dec(c.valor));
      else {
        if (!c.valorUpf) erro(`Informe o valor da UPF para calcular ${c.nome}.`);
        valor += multiplicar(toneladas, percentual(dec(c.valorUpf), dec(c.valor)));
      }
    }
    return { nome: c.nome, valor: arredondar(valor, 2), codigoReceita: c.codigoReceita ?? null };
  });

  // Guias da nota
  const guias: GuiaCalculada[] = [];
  if (e.icmsPorOperacao && totais.vICMS > 0n) {
    guias.push({ tipo: "icms_operacao", descricao: "ICMS da operação (pago antes da saída)", uf: ufEmit, valor: totais.vICMS + totais.vFCP, codigoReceita: null });
  }
  if (icmsFrete && icmsFrete.vICMSRet > 0n) {
    guias.push({ tipo: "icms_frete", descricao: "ICMS do frete (retido pelo remetente)", uf: ufEmit, valor: icmsFrete.vICMSRet, codigoReceita: null });
  }
  if (totais.vICMSUFDest > 0n) {
    guias.push({ tipo: "difal", descricao: `DIFAL — complementação de alíquota devida a ${ufDest}`, uf: ufDest, valor: totais.vICMSUFDest, codigoReceita: null });
  }
  if (totais.vFCPUFDest > 0n) {
    guias.push({ tipo: "fcp_difal", descricao: `FCP do DIFAL devido a ${ufDest}`, uf: ufDest, valor: totais.vFCPUFDest, codigoReceita: null });
  }
  for (const c of contribuicoes) {
    if (c.valor > 0n) guias.push({ tipo: "contribuicao", descricao: c.nome, uf: ufEmit, valor: c.valor, codigoReceita: c.codigoReceita });
  }

  const real = (v: Dec) => `R$ ${fmt(v, 2).replace(".", ",")}`;
  const pct = (v: Dec) => `${fmt(v, 2).replace(".", ",")}%`;
  const textosAutomaticos: string[] = [];
  if (icmsFrete) {
    textosAutomaticos.push(
      `ICMS sobre o frete retido pelo remetente: base ${real(icmsFrete.vBCRet)}, alíquota ${pct(icmsFrete.pICMSRet)}, valor ${real(icmsFrete.vICMSRet)}.`,
    );
  }
  if (totais.vICMSUFDest > 0n || totais.vFCPUFDest > 0n) {
    textosAutomaticos.push(`DIFAL devido a ${ufDest}: ICMS ${real(totais.vICMSUFDest)}; FCP ${real(totais.vFCPUFDest)}.`);
  }
  if (funrural) {
    textosAutomaticos.push(
      `Contribuição previdenciária rural (FUNRURAL/SENAR) de ${pct(funrural.percentual)} sobre ${real(funrural.base)}: ${real(funrural.valor)}` +
        (funrural.modo === "retido_adquirente" ? ", a ser retida pelo adquirente." : ", recolhida pelo produtor."),
    );
  }
  for (const c of contribuicoes) if (c.valor > 0n) textosAutomaticos.push(`${c.nome}: ${real(c.valor)}.`);
  if (e.transporte.veiculo && idDest !== 1) {
    textosAutomaticos.push(`Veículo: placa ${e.transporte.veiculo.placa}${e.transporte.veiculo.uf ? `/${e.transporte.veiculo.uf}` : ""}.`);
  }
  return { entrada: e, idDest, consumidorFinal, itens, totais, icmsFrete, pesoLiquidoKg, funrural, contribuicoes, guias, textosAutomaticos };
}
