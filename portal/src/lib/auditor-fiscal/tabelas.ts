import type { Fonte } from "@/lib/calculos/tabelas";

/**
 * Tabelas do auditor fiscal (conferidas no texto vigente em 02/10/2026).
 * Os valores do Simples estão na LC 123/2006, Anexos I e II (redação da
 * LC 155/2016, vigentes desde 01/01/2018 — cobrem todo o prazo de 5 anos).
 */

/** Percentual de cada tributo dentro do DAS, por faixa (Anexos I e II). */
export interface Reparticao {
  irpj: string;
  csll: string;
  cofins: string;
  pis: string;
  cpp: string;
  ipi: string | null;
  /** Nulo na 6ª faixa: o ICMS é pago fora do DAS. */
  icms: string | null;
}

const ANEXO_I: Reparticao[] = [
  { irpj: "5.50", csll: "3.50", cofins: "12.74", pis: "2.76", cpp: "41.50", ipi: null, icms: "34.00" },
  { irpj: "5.50", csll: "3.50", cofins: "12.74", pis: "2.76", cpp: "41.50", ipi: null, icms: "34.00" },
  { irpj: "5.50", csll: "3.50", cofins: "12.74", pis: "2.76", cpp: "42.00", ipi: null, icms: "33.50" },
  { irpj: "5.50", csll: "3.50", cofins: "12.74", pis: "2.76", cpp: "42.00", ipi: null, icms: "33.50" },
  { irpj: "5.50", csll: "3.50", cofins: "12.74", pis: "2.76", cpp: "42.00", ipi: null, icms: "33.50" },
  { irpj: "13.50", csll: "10.00", cofins: "28.27", pis: "6.13", cpp: "42.10", ipi: null, icms: null },
];

const ANEXO_II: Reparticao[] = [
  { irpj: "5.50", csll: "3.50", cofins: "11.51", pis: "2.49", cpp: "37.50", ipi: "7.50", icms: "32.00" },
  { irpj: "5.50", csll: "3.50", cofins: "11.51", pis: "2.49", cpp: "37.50", ipi: "7.50", icms: "32.00" },
  { irpj: "5.50", csll: "3.50", cofins: "11.51", pis: "2.49", cpp: "37.50", ipi: "7.50", icms: "32.00" },
  { irpj: "5.50", csll: "3.50", cofins: "11.51", pis: "2.49", cpp: "37.50", ipi: "7.50", icms: "32.00" },
  { irpj: "5.50", csll: "3.50", cofins: "11.51", pis: "2.49", cpp: "37.50", ipi: "7.50", icms: "32.00" },
  { irpj: "8.50", csll: "7.50", cofins: "20.96", pis: "4.54", cpp: "23.50", ipi: "35.00", icms: null },
];

export const REPARTICAO_SIMPLES: Record<"I" | "II", Reparticao[]> = { I: ANEXO_I, II: ANEXO_II };

export const FONTES = {
  segregacao: {
    titulo: "LC nº 123/2006, art. 18, § 4º-A, I (segregação das receitas monofásicas e com ICMS-ST no PGDAS-D) e Anexos I e II (partilha)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm",
  },
  restituicao: {
    titulo: "CTN, arts. 165 e 168 (restituição em até 5 anos do pagamento)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm",
  },
  st: {
    titulo: "Convênio ICMS nº 142/2018 (regimes de substituição tributária)",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  ibsCbs: {
    titulo: "LC nº 214/2025, arts. 343, 346 e 348 (CBS 0,9% e IBS 0,1% em 2026; dispensa de recolhimento condicionada ao destaque)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm",
  },
  notaTecnica: {
    titulo: "NT 2025.002 (NF-e e NFC-e: grupo IBSCBS) e Ato Técnico Conjunto RFB/CGIBS nº 1/2026 (validação suspensa, obrigação mantida)",
    url: "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY=",
  },
} satisfies Record<string, Fonte>;

/** Alíquotas de teste do IBS/CBS em 2026 (LC 214/2025, arts. 343 e 346). */
export const TESTE_2026 = { cbs: "0.9", ibsUf: "0.1", ibsMun: "0" };

/** Destaque do IBS/CBS obrigatório na NF-e/NFC-e: regime normal e Simples (ondas do cronograma). */
export const OBRIGACAO_IBS_CBS = { regimeNormal: "2026-08-03", simples: "2027-01-01" };

/** PIS/Cofins quando o item não traz o valor (estimativa pelo regime). */
export const PIS_COFINS_ESTIMADO = { lucro_presumido: "3.65", lucro_real: "9.25", lucro_arbitrado: "3.65" } as Record<string, string>;

/** Base legal das regras das notas de serviço (conferidas no texto vigente em 02/10/2026). */
export const FONTES_SERVICOS = {
  issRetidoSimples: {
    titulo: "LC nº 123/2006, art. 21, § 4º, VII (o ISS retido é definitivo e sobre essa receita não há ISS a recolher no Simples)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm",
  },
  segregacaoIss: {
    titulo: "LC nº 123/2006, art. 18, § 4º-A, II (receita com ISS retido separada no PGDAS-D)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm",
  },
  anexosServicos: {
    titulo: "LC nº 123/2006, Anexos III, IV e V (partilha do ISS por faixa; parte efetiva do ISS limitada a 5%)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm",
  },
  aliquotaRetencao: {
    titulo: "LC nº 123/2006, art. 21, § 4º, I e VI (alíquota da retenção = ISS efetivo do mês anterior; diferença em guia do município)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm",
  },
  irrfSimples: {
    titulo: "Instrução Normativa RFB nº 765/2007, art. 1º (dispensa da retenção do IR para empresas do Simples Nacional)",
    url: "https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?visao=anotado&idAto=15713",
  },
  csrfSimples: {
    titulo: "Lei nº 10.833/2003, arts. 30 e 32, III (PIS, Cofins e CSLL não são retidos de empresas do Simples)",
    url: "https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833.htm",
  },
  inssSimples: {
    titulo: "IN RFB nº 2.110/2022, arts. 166 e 167, e Súmula 425 do STJ (no Simples, a retenção de 11% do INSS só vale para o Anexo IV)",
    url: "https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=126687",
  },
  leiauteNfse: {
    titulo: "NFS-e Nacional — leiaute da DPS (regime do prestador: opSimpNac) e NT SE/CGNFS-e nº 007/2026",
    url: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica",
  },
  restituicao: FONTES.restituicao,
} satisfies Record<string, Fonte>;
