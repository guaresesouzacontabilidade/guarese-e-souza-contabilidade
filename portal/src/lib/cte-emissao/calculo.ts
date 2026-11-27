import { calcularIbsCbs, dataHoraUf, type AmbienteNfe, type IbsCbsCalculado, type RegraIbsCbs } from "@/lib/nfe-emissao/calculo";
import { arredondar, dec, maior, percentual, type Dec } from "@/lib/nfe-emissao/decimal";

/**
 * Cálculo do CT-e rodoviário (modelo 57): ICMS da prestação conforme a regra
 * da operação do frete (cadastrada pelo escritório), IBS/CBS (alíquotas de
 * teste de 2026: CBS 0,9% e IBS da UF 0,1%) e o total do documento. Em 2026 o
 * total do DF-e (vTotDFe) é o próprio valor da prestação (NT 2025.001, regra
 * 365: "em 2026 não somar IBS e CBS").
 */

export type AmbienteCte = AmbienteNfe;

export interface EnderecoCte {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  codigoMunicipio: string;
  municipio: string;
  uf: string;
  cep?: string | null;
  telefone?: string | null;
}

export interface ParticipanteCte {
  tipo: "cnpj" | "cpf";
  documento: string;
  nome: string;
  /** 1 contribuinte; 2 isento; 9 não contribuinte */
  indicadorIe: number;
  inscricaoEstadual?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco: EnderecoCte;
}

export interface RegraIcmsCte {
  /** 00, 20, 40, 41, 51, 60, 90 ou "sn" (Simples Nacional) */
  cst: string;
  aliquota?: number | null;
  reducaoBase?: number | null;
  /** Crédito presumido/outorgado: percentual sobre o ICMS (CST 60 e 90) */
  creditoPresumido?: number | null;
  beneficio?: string | null;
}

export interface EntradaCte {
  ambiente: AmbienteCte;
  emitidoEm: Date;
  serie: number;
  numero: number;
  codigoNumerico: string;
  natureza: string;
  cfop: string;
  emitente: {
    documento: string;
    nome: string;
    fantasia?: string | null;
    inscricaoEstadual: string;
    crt: number;
    endereco: EnderecoCte;
  };
  rntrc: string;
  /** papel: 0 remetente; 3 destinatário; 4 outro (com o participante) */
  tomador: { papel: 0 | 3 | 4; indicadorIe: number; participante?: ParticipanteCte | null };
  remetente: ParticipanteCte;
  destinatario: ParticipanteCte;
  inicio: { codigoMunicipio: string; municipio: string; uf: string };
  fim: { codigoMunicipio: string; municipio: string; uf: string };
  valorPrestacao: string;
  valorReceber: string;
  componentes: { nome: string; valor: number | string }[];
  icms: RegraIcmsCte;
  ibscbs: (RegraIbsCbs & { excluirIcms?: boolean | null }) | null;
  carga: { valor?: string | null; produto: string; outras?: string | null; pesoKg: string };
  nfes: string[];
  observacoes?: string | null;
  responsavelTecnico?: { cnpj: string; contato: string; email: string; telefone: string } | null;
  autorizadosXml?: string[];
}

export interface IcmsCteCalculado {
  /** Grupo do leiaute: ICMS00, ICMS20, ICMS45, ICMS60, ICMS90 ou ICMSSN */
  grupo: "ICMS00" | "ICMS20" | "ICMS45" | "ICMS60" | "ICMS90" | "ICMSSN";
  cst: string;
  vBC: Dec;
  pRedBC: Dec | null;
  pICMS: Dec | null;
  vICMS: Dec;
  vCred: Dec | null;
  beneficio: string | null;
}

export interface CteCalculado {
  entrada: EntradaCte;
  vTPrest: Dec;
  vRec: Dec;
  icms: IcmsCteCalculado;
  ibscbs: IbsCbsCalculado | null;
  /** Total do documento fiscal (vTotDFe) */
  vTotDFe: Dec;
  /** Valor aproximado dos tributos (ICMS + IBS + CBS), para o DACTE */
  vTotTrib: Dec;
}

function erro(msg: string): never {
  throw new Error(msg);
}

export function calcularIcmsCte(regra: RegraIcmsCte, vTPrest: Dec): IcmsCteCalculado {
  const aliquota = regra.aliquota == null ? null : dec(regra.aliquota);
  const vazio = { vBC: 0n, pRedBC: null, pICMS: null, vICMS: 0n, vCred: null, beneficio: regra.beneficio ?? null };
  const credito = (vICMS: Dec) => (regra.creditoPresumido ? arredondar(percentual(vICMS, dec(regra.creditoPresumido)), 2) : null);
  switch (regra.cst) {
    case "00": {
      if (aliquota == null) erro("Falta a alíquota do ICMS (CST 00).");
      return { grupo: "ICMS00", cst: "00", ...vazio, vBC: vTPrest, pICMS: aliquota, vICMS: arredondar(percentual(vTPrest, aliquota), 2) };
    }
    case "20": {
      if (aliquota == null || !regra.reducaoBase) erro("Faltam a alíquota e a redução da base do ICMS (CST 20).");
      const pRed = dec(regra.reducaoBase);
      const vBC = arredondar(vTPrest - percentual(vTPrest, pRed), 2);
      return { grupo: "ICMS20", cst: "20", ...vazio, vBC, pRedBC: pRed, pICMS: aliquota, vICMS: arredondar(percentual(vBC, aliquota), 2) };
    }
    case "40":
    case "41":
    case "51":
      return { grupo: "ICMS45", cst: regra.cst, ...vazio };
    case "60": {
      // ICMS cobrado por substituição tributária (o tomador recolhe): base, alíquota e valor retidos
      if (aliquota == null) erro("Falta a alíquota do ICMS retido (CST 60).");
      const vICMS = arredondar(percentual(vTPrest, aliquota), 2);
      return { grupo: "ICMS60", cst: "60", ...vazio, vBC: vTPrest, pICMS: aliquota, vICMS, vCred: credito(vICMS) };
    }
    case "90": {
      if (aliquota == null) erro("Falta a alíquota do ICMS (CST 90).");
      const pRed = regra.reducaoBase ? dec(regra.reducaoBase) : null;
      const vBC = pRed ? arredondar(vTPrest - percentual(vTPrest, pRed), 2) : vTPrest;
      const vICMS = arredondar(percentual(vBC, aliquota), 2);
      return { grupo: "ICMS90", cst: "90", ...vazio, vBC, pRedBC: pRed, pICMS: aliquota, vICMS, vCred: credito(vICMS) };
    }
    case "sn":
      return { grupo: "ICMSSN", cst: "90", ...vazio };
    default:
      return erro(`CST ${regra.cst} do ICMS não aceito no CT-e pelo portal.`);
  }
}

export function calcularCte(e: EntradaCte): CteCalculado {
  const vTPrest = dec(e.valorPrestacao);
  if (vTPrest <= 0n) erro("O valor do frete precisa ser maior que zero.");
  const vRec = dec(e.valorReceber);
  if (vRec > vTPrest) erro("O valor a receber não pode ser maior que o valor do frete.");
  if (e.componentes.length) {
    const soma = e.componentes.reduce((s, c) => s + dec(c.valor), 0n);
    if (soma !== vTPrest) erro("A soma dos componentes precisa ser igual ao valor do frete.");
  }
  const icms = calcularIcmsCte(e.icms, vTPrest);
  const ano = Number(dataHoraUf(e.emitidoEm, e.emitente.endereco.uf).slice(0, 4));
  let ibscbs: IbsCbsCalculado | null = null;
  if (e.ibscbs) {
    // Base comum do IBS/CBS: o valor da prestação, sem o ICMS do frete (quando a operação manda excluir)
    const icmsProprio = icms.grupo === "ICMS60" ? 0n : icms.vICMS;
    const vBC = maior(0n, vTPrest - (e.ibscbs.excluirIcms === false ? 0n : icmsProprio));
    ibscbs = calcularIbsCbs(e.ibscbs, arredondar(vBC, 2), ano);
  }
  // NT 2025.001, regra 365: em 2026 o total do DF-e não soma o IBS e a CBS
  const vTotDFe = ano <= 2026 || !ibscbs ? vTPrest : vTPrest + ibscbs.vIBS + ibscbs.cbs.valor;
  const vTotTrib = (icms.grupo === "ICMS60" ? 0n : icms.vICMS) + (ibscbs ? ibscbs.vIBS + ibscbs.cbs.valor : 0n);
  return { entrada: e, vTPrest, vRec, icms, ibscbs, vTotDFe, vTotTrib };
}
