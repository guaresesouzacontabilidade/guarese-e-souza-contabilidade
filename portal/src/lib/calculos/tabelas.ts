/**
 * Tabelas oficiais usadas nos cálculos (previsão de impostos e rescisão),
 * cada uma com a fonte e o início da vigência. Quando uma tabela muda (todo
 * janeiro, no caso do salário mínimo, INSS e IRRF), acrescente a nova versão
 * com a fonte — as anteriores continuam valendo para as competências antigas.
 */

export interface Fonte {
  titulo: string;
  url?: string;
}

interface Vigencia<T> {
  /** Primeira competência em que vale (AAAA-MM). */
  inicio: string;
  dados: T;
  fonte: Fonte;
}

/** Previsões a partir desta competência (tabelas cadastradas). */
export const PRIMEIRA_COMPETENCIA = "2026-01";

/** Versão vigente na competência e aviso quando o ano ainda não tem tabela cadastrada. */
export function vigente<T>(lista: Vigencia<T>[], competencia: string): { dados: T; fonte: Fonte; aviso: string | null } {
  const comp = competencia.slice(0, 7);
  const ordenada = [...lista].sort((a, b) => b.inicio.localeCompare(a.inicio));
  const v = ordenada.find((x) => x.inicio <= comp) ?? ordenada[ordenada.length - 1];
  const anoTabela = v.inicio.slice(0, 4);
  const aviso =
    comp.slice(0, 4) > anoTabela && v === ordenada[0]
      ? `${v.fonte.titulo}: a tabela de ${comp.slice(0, 4)} ainda não foi cadastrada no portal; foi usada a de ${anoTabela}.`
      : null;
  return { dados: v.dados, fonte: v.fonte, aviso };
}

// -----------------------------------------------------------------------------
// Salário mínimo
// -----------------------------------------------------------------------------
export const SALARIO_MINIMO: Vigencia<string>[] = [
  {
    inicio: "2026-01",
    dados: "1621.00",
    fonte: { titulo: "Salário mínimo de 2026 — Decreto nº 12.797/2025", url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/D12797.htm" },
  },
];

// -----------------------------------------------------------------------------
// INSS do empregado (alíquotas progressivas por faixa)
// -----------------------------------------------------------------------------
export interface TabelaInss {
  faixas: { ate: string; aliquota: string }[];
  teto: string;
}

export const INSS_EMPREGADO: Vigencia<TabelaInss>[] = [
  {
    inicio: "2026-01",
    dados: {
      faixas: [
        { ate: "1621.00", aliquota: "7.5" },
        { ate: "2902.84", aliquota: "9" },
        { ate: "4354.27", aliquota: "12" },
        { ate: "8475.55", aliquota: "14" },
      ],
      teto: "8475.55",
    },
    fonte: {
      titulo: "INSS 2026 — Portaria Interministerial MPS/MF nº 13/2026",
      url: "https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal",
    },
  },
];

// -----------------------------------------------------------------------------
// IRRF mensal (tabela progressiva + redução da Lei 15.270/2025)
// -----------------------------------------------------------------------------
export interface TabelaIrrf {
  faixas: { ate: string | null; aliquota: string; deduzir: string }[];
  dependente: string;
  descontoSimplificado: string;
  /** Redução mensal: até `isencaoAte` o imposto é zerado (até `reducaoMaxima`); até `reducaoAte`, redução = a − b × rendimento. */
  reducao: { isencaoAte: string; reducaoMaxima: string; reducaoAte: string; a: string; b: string } | null;
}

export const IRRF: Vigencia<TabelaIrrf>[] = [
  {
    inicio: "2026-01",
    dados: {
      faixas: [
        { ate: "2428.80", aliquota: "0", deduzir: "0" },
        { ate: "2826.65", aliquota: "7.5", deduzir: "182.16" },
        { ate: "3751.05", aliquota: "15", deduzir: "394.16" },
        { ate: "4664.68", aliquota: "22.5", deduzir: "675.49" },
        { ate: null, aliquota: "27.5", deduzir: "908.73" },
      ],
      dependente: "189.59",
      descontoSimplificado: "607.20",
      reducao: { isencaoAte: "5000.00", reducaoMaxima: "312.89", reducaoAte: "7350.00", a: "978.62", b: "0.133145" },
    },
    fonte: {
      titulo: "IRRF 2026 — Leis nº 15.191/2025 e nº 15.270/2025 (Receita Federal)",
      url: "https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026",
    },
  },
];

// -----------------------------------------------------------------------------
// Simples Nacional — Anexos I a V (LC 123/2006, redação da LC 155/2016)
// -----------------------------------------------------------------------------
export type Anexo = "I" | "II" | "III" | "IV" | "V";

export interface FaixaSimples {
  ate: string;
  aliquota: string;
  deduzir: string;
  /** Parcela do ICMS (Anexos I e II) ou do ISS (III a V) na alíquota efetiva, em %. Nula na 6ª faixa (pago fora do DAS). */
  icms?: string | null;
  iss?: string | null;
}

export const FONTE_SIMPLES: Fonte = {
  titulo: "Simples Nacional — LC 123/2006, Anexos I a V (LC 155/2016) e Resolução CGSN nº 140/2018",
  url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm",
};

const LIMITES = ["180000.00", "360000.00", "720000.00", "1800000.00", "3600000.00", "4800000.00"];

function anexo(aliquotas: string[], deduzir: string[], parcela: "icms" | "iss", parcelas: (string | null)[]): FaixaSimples[] {
  return LIMITES.map((ate, i) => ({ ate, aliquota: aliquotas[i], deduzir: deduzir[i], [parcela]: parcelas[i] }));
}

export const ANEXOS_SIMPLES: Record<Anexo, FaixaSimples[]> = {
  I: anexo(["4", "7.3", "9.5", "10.7", "14.3", "19"], ["0", "5940", "13860", "22500", "87300", "378000"], "icms", ["34", "34", "33.5", "33.5", "33.5", null]),
  II: anexo(["4.5", "7.8", "10", "11.2", "14.7", "30"], ["0", "5940", "13860", "22500", "85500", "720000"], "icms", ["32", "32", "32", "32", "32", null]),
  III: anexo(["6", "11.2", "13.5", "16", "21", "33"], ["0", "9360", "17640", "35640", "125640", "648000"], "iss", ["33.5", "32", "32.5", "32.5", "33.5", null]),
  IV: anexo(["4.5", "9", "10.2", "14", "22", "33"], ["0", "8100", "12420", "39780", "183780", "828000"], "iss", ["44.5", "40", "40", "40", "40", null]),
  V: anexo(["15.5", "18", "19.5", "20.5", "23", "30.5"], ["0", "4500", "9900", "17100", "62100", "540000"], "iss", ["14", "17", "19", "21", "23.5", null]),
};

export const SIMPLES = {
  sublimite: "3600000.00",
  limite: "4800000.00",
  /** Percentual efetivo máximo do ISS dentro do DAS. */
  issMaximo: "5",
  /** Fator R: folha de 12 meses ÷ receita de 12 meses. */
  fatorR: "28",
};

// -----------------------------------------------------------------------------
// MEI (LC 123/2006, art. 18-A): valores fixos mensais
// -----------------------------------------------------------------------------
export const MEI = {
  inssPercentual: "5",
  inssCaminhoneiro: "12",
  icms: "1.00",
  iss: "5.00",
  limiteAnual: "81000.00",
  /** CPP do MEI sobre o salário do empregado (LC 123/2006, art. 18-C). */
  cppEmpregado: "3",
  fonte: {
    titulo: "MEI — LC 123/2006, art. 18-A e 18-C; DAS mensal com base no salário mínimo",
    url: "https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/servicos-para-mei/pagamento-de-contribuicao-mensal",
  } as Fonte,
};

// -----------------------------------------------------------------------------
// Lucro Presumido e Lucro Real
// -----------------------------------------------------------------------------
export const IRPJ_CSLL = {
  irpj: "15",
  adicional: "10",
  /** Parcela isenta do adicional por mês de apuração. */
  adicionalLimiteMensal: "20000.00",
  csll: "9",
  fonte: {
    titulo: "IRPJ e CSLL — Lei nº 9.249/1995 (arts. 3º, 15 e 20) e Lei nº 9.430/1996",
    url: "https://www.planalto.gov.br/ccivil_03/leis/l9249.htm",
  } as Fonte,
};

/** LC 224/2025: +10% nos percentuais de presunção sobre a receita acima de R$ 5 milhões no ano. */
export const LC224 = {
  limiteAnual: "5000000.00",
  limiteTrimestral: "1250000.00",
  acrescimo: "10",
  inicioIrpj: "2026-01",
  inicioCsll: "2026-04",
  fonte: { titulo: "Lei Complementar nº 224/2025 (art. 4º, § 4º, VII e § 5º)", url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp224.htm" } as Fonte,
};

export const PIS_COFINS = {
  cumulativo: { pis: "0.65", cofins: "3" },
  naoCumulativo: { pis: "1.65", cofins: "7.6" },
  fonteCumulativo: { titulo: "PIS e Cofins cumulativos — Lei nº 9.718/1998", url: "https://www.planalto.gov.br/ccivil_03/leis/l9718compilada.htm" } as Fonte,
  fonteNaoCumulativo: {
    titulo: "PIS e Cofins não cumulativos — Leis nº 10.637/2002 e nº 10.833/2003",
    url: "https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833.htm",
  } as Fonte,
};

// -----------------------------------------------------------------------------
// Folha
// -----------------------------------------------------------------------------
export const FOLHA = {
  fgts: "8",
  cpp: "20",
  proLaboreInss: "11",
  fonteFgts: { titulo: "FGTS — Lei nº 8.036/1990, art. 15", url: "https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm" } as Fonte,
  fonteCpp: { titulo: "Contribuições sobre a folha — Lei nº 8.212/1991, arts. 21 e 22", url: "https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm" } as Fonte,
};

// -----------------------------------------------------------------------------
// Rescisão
// -----------------------------------------------------------------------------
export const RESCISAO = {
  multaFgts: "40",
  multaFgtsAcordo: "20",
  avisoBase: 30,
  avisoPorAno: 3,
  avisoMaximo: 90,
  fonteClt: { titulo: "CLT — arts. 477, 479, 484-A e 487 (Decreto-Lei nº 5.452/1943)", url: "https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm" } as Fonte,
  fonteAviso: { titulo: "Aviso prévio proporcional — Lei nº 12.506/2011", url: "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12506.htm" } as Fonte,
  fonteMulta: { titulo: "Multa do FGTS — Lei nº 8.036/1990, art. 18", url: "https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm" } as Fonte,
};

export const CBS_IBS_2026: Fonte = {
  titulo: "CBS e IBS em 2026 (ano de teste) — Lei Complementar nº 214/2025",
  url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm",
};
