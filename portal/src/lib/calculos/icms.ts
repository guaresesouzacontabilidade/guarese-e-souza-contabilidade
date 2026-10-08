import Decimal from "decimal.js";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { somarMeses } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { ORIGENS_IMPORTADAS, aliquotaInterestadual } from "@/lib/fiscal/icms-estados";
import { REGRAS_ICMS, reducaoComplementacao, type RegrasIcmsUf } from "./icms-regras";
import type { Fonte } from "./tabelas";

/**
 * Apuração do ICMS do mês a partir das notas guardadas no portal.
 *
 *  - Regime normal (Lucro Presumido, Real ou Arbitrado), contribuinte do ICMS:
 *    débitos (ICMS das saídas) − créditos (ICMS das entradas que dão crédito)
 *    − saldo credor do mês anterior, com os lançamentos do escritório, como no
 *    registro E110 da EFD ICMS/IPI.
 *  - Simples Nacional e MEI: o ICMS das vendas está no DAS; fora dele, a
 *    complementação de alíquota nas compras de outros estados para revenda ou
 *    industrialização (regra do estado) e o diferencial de alíquotas (DIFAL)
 *    nas compras de outros estados para uso e consumo ou ativo imobilizado.
 *  - Todos: ICMS-ST retido nas vendas (substituto), DIFAL das vendas a
 *    consumidor final de outro estado e guias lançadas pelo escritório.
 *
 * A nota do fornecedor não informa a destinação da compra: vale a escolha do
 * escritório (item → nota → fornecedor → padrão da empresa). É uma apuração
 * de conferência: os valores oficiais são os da escrituração e das guias.
 */

// -----------------------------------------------------------------------------
// Dados recebidos do banco (public.dados_apuracao_icms)
// -----------------------------------------------------------------------------
type Num = number | string | null | undefined;

export type Destinacao = "revenda" | "uso_consumo" | "ativo" | "nao_se_aplica";

export const DESTINACOES: Record<Destinacao, { rotulo: string; curto: string }> = {
  revenda: { rotulo: "Revenda ou industrialização", curto: "Revenda/industr." },
  uso_consumo: { rotulo: "Uso e consumo", curto: "Uso e consumo" },
  ativo: { rotulo: "Ativo imobilizado", curto: "Ativo" },
  nao_se_aplica: { rotulo: "Não entra no cálculo (remessa, retorno, bonificação...)", curto: "Não entra" },
};

export interface ItemEntradaDados {
  n: number;
  cfop?: string | null;
  ncm?: string | null;
  cest?: string | null;
  descricao?: string | null;
  valor: Num;
  desconto?: Num;
  orig?: string | null;
  cst?: string | null;
  csosn?: string | null;
  bc?: Num;
  p_icms?: Num;
  icms?: Num;
  icms_st?: Num;
  icms_st_retido?: Num;
  cred_sn?: Num;
  ipi?: Num;
  frete?: Num;
  seguro?: Num;
  outros?: Num;
  destinacao?: Destinacao | null;
}

export interface NotaEntradaDados {
  id: string;
  modelo: string;
  numero: string | null;
  serie: string | null;
  data: string | null;
  emitente: string | null;
  emitente_documento: string | null;
  emitente_uf: string | null;
  propria: boolean;
  crt: string | null;
  valor_total: Num;
  valor_produtos: Num;
  frete: Num;
  outros: Num;
  seguro: Num;
  icms: Num;
  leitura: number;
  destinacao: Destinacao | null;
  /** Regra do fornecedor desta nota (quando houver). */
  destinacao_fornecedor?: Destinacao | null;
  itens: ItemEntradaDados[];
}

export type TipoLancamentoIcms = "outro_debito" | "estorno_credito" | "outro_credito" | "estorno_debito" | "deducao" | "guia_extra";

export const TIPOS_LANCAMENTO_ICMS: Record<TipoLancamentoIcms, { rotulo: string; ajuda: string; regimeNormal: boolean }> = {
  outro_debito: { rotulo: "Outros débitos", ajuda: "Débitos que não estão nas notas (ex.: ajuste da apuração).", regimeNormal: true },
  estorno_credito: { rotulo: "Estorno de crédito", ajuda: "Crédito tomado que precisa ser devolvido (ex.: perda, saída isenta).", regimeNormal: true },
  outro_credito: { rotulo: "Outros créditos", ajuda: "Ex.: parcela do mês do CIAP (ativo, 1/48), crédito de nota sem XML no portal.", regimeNormal: true },
  estorno_debito: { rotulo: "Estorno de débito", ajuda: "Débito lançado a mais que precisa ser anulado.", regimeNormal: true },
  deducao: { rotulo: "Dedução", ajuda: "Valores que reduzem o imposto a recolher (ex.: incentivo fiscal).", regimeNormal: true },
  guia_extra: { rotulo: "Outra guia de ICMS", ajuda: "ICMS pago em guia à parte (ex.: ICMS-ST na entrada sem retenção, antecipação).", regimeNormal: false },
};

export interface ApuracaoSped {
  debitos: string;
  ajustes_debito: string;
  estornos_credito: string;
  creditos: string;
  ajustes_credito: string;
  estornos_debito: string;
  saldo_credor_anterior: string;
  saldo_devedor: string;
  deducoes: string;
  a_recolher: string;
  saldo_credor_transportar: string;
  extra_apuracao: string;
}

export interface ResultadoGuardado {
  versao: number;
  a_recolher: string;
  saldo_credor_transportar: string;
  total_guias: string;
  saldo_anterior: string;
  modo: ModoIcms;
  linhas: { chave: string; titulo: string; guia: string; valor: string; vencimento: string | null }[];
  propria: Record<string, string> | null;
}

export interface DadosIcms {
  competencia: string;
  empresa: { nome: string; uf: string | null; regime: string | null; contribuinte_icms: boolean; inscricao_estadual: boolean };
  gerenciar: boolean;
  detalhe: boolean;
  destinacao_padrao: "revenda" | "uso_consumo";
  aliquota_interna: { uf: string; aliquota: Num; situacao: string; fcp: Num; base_legal: string | null; fonte_url: string | null } | null;
  saidas: { cfop: string; notas: number; valor: Num; base: Num; icms: Num }[];
  saidas_totais: { notas: number; nfce: number; icms_st: Num; fcp: Num; difal_destino: Num; fcp_destino: Num; vendas_outro_estado_consumidor: number } | null;
  entradas: NotaEntradaDados[];
  fornecedores: Record<string, Destinacao>;
  leitura_antiga: number;
  lancamentos: { id: string; tipo: TipoLancamentoIcms; descricao: string; valor: Num; observacao: string | null }[];
  apuracao: {
    saldo_credor_anterior: Num;
    saldo_observacao: string | null;
    conferida_em: string | null;
    conferida_por: string | null;
    a_recolher: Num;
    saldo_credor_transportar: Num;
    total_guias: Num;
    resultado: ResultadoGuardado | null;
    reaberta_em: string | null;
    motivo_reabertura: string | null;
  } | null;
  anterior: { conferida: boolean; saldo_credor_transportar: Num } | null;
  sped: { arquivo_id: string; nome: string | null; apuracao: ApuracaoSped; conferido_em: string | null } | null;
  releitura_pendente: boolean;
  vencimentos: { codigo: string; vencimento: string | null }[];
}

// -----------------------------------------------------------------------------
// Resultado
// -----------------------------------------------------------------------------
export type ModoIcms = "normal" | "simples" | "nao_contribuinte" | "sem_regime";
export type TipoEntrada = "compra" | "devolucao" | "transferencia" | "outras" | "frete";

export interface ItemCalculado {
  n: number;
  descricao: string | null;
  cfop: string | null;
  ncm: string | null;
  tipo: TipoEntrada;
  destinacao: Destinacao;
  origemDestinacao: "item" | "nota" | "fornecedor" | "cfop" | "padrao" | "tipo";
  escolhaItem: Destinacao | null;
  interestadual: boolean;
  st: boolean;
  possivelSt: boolean;
  valorOperacao: Decimal;
  rateado: boolean;
  aliquotaInterestadual: number | null;
  aliquotaDestacada: number | null;
  icmsDestacado: Decimal;
  creditoSimples: Decimal;
  credito: Decimal;
  semCredito: string | null;
  complementacao: Decimal;
  difal: Decimal;
  memoria: string[];
}

export interface NotaCalculada {
  id: string;
  modelo: string;
  numero: string | null;
  serie: string | null;
  data: string | null;
  emitente: string | null;
  emitenteDocumento: string | null;
  emitenteUf: string | null;
  propria: boolean;
  interestadual: boolean;
  escolhaNota: Destinacao | null;
  escolhaFornecedor: Destinacao | null;
  /** Destinação comum aos itens (ou null quando há itens com destinações diferentes). */
  destinacao: Destinacao | null;
  itens: ItemCalculado[];
  valor: Decimal;
  credito: Decimal;
  complementacao: Decimal;
  difal: Decimal;
}

export interface LinhaIcms {
  chave: string;
  titulo: string;
  guia: string;
  valor: Decimal;
  detalhes: string[];
  vencimento: string | null;
  vencimentoTexto: string;
}

export interface ApuracaoPropria {
  debitos: Decimal;
  outrosDebitos: Decimal;
  estornosCredito: Decimal;
  creditos: Decimal;
  outrosCreditos: Decimal;
  estornosDebito: Decimal;
  saldoAnterior: Decimal;
  origemSaldo: "informado" | "mes_anterior" | "sem_informacao";
  saldoDevedor: Decimal;
  deducoes: Decimal;
  aRecolher: Decimal;
  saldoCredorTransportar: Decimal;
  debitosPorCfop: { cfop: string; notas: number; valor: Decimal; base: Decimal; icms: Decimal; excluido: string | null }[];
  creditosPorGrupo: { chave: string; rotulo: string; icms: Decimal; creditado: boolean }[];
}

export interface ComparacaoSped {
  rotulo: string;
  portal: Decimal;
  sped: Decimal;
  diferente: boolean;
}

export interface ResultadoIcms {
  competencia: string;
  mesPagamento: string;
  regime: string | null;
  regimeRotulo: string;
  uf: string | null;
  modo: ModoIcms;
  mensagem: string | null;
  regras: RegrasIcmsUf | null;
  aliquotaInterna: number | null;
  propria: ApuracaoPropria | null;
  linhas: LinhaIcms[];
  totalGuias: Decimal;
  notas: NotaCalculada[];
  resumoEntradas: {
    notas: number;
    interestaduais: number;
    itensPadrao: number;
    itensRateados: number;
    possivelSt: number;
    ativoIcms: Decimal;
  };
  comparacaoSped: ComparacaoSped[] | null;
  avisos: string[];
  fontes: Fonte[];
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------
const CEM = new Decimal(100);
const ZERO = new Decimal(0);
const moeda = (v: Decimal) => formatarMoeda(v);
const pctTxt = (v: number | Decimal) => `${String(Number(v.toString()).toFixed(2)).replace(/\.?0+$/, "").replace(".", ",")}%`;

const REGIMES_NORMAIS = new Set(["lucro_presumido", "lucro_real", "lucro_arbitrado"]);
const REGIMES_SIMPLES = new Set(["simples_nacional", "mei"]);
const UFS = /^(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)$/;

/** Tipo da entrada pelo CFOP (da nota do fornecedor — 5/6/7 — ou da nota de entrada da própria empresa — 1/2/3). */
export function tipoEntrada(cfop: string | null | undefined, modelo = "55"): TipoEntrada {
  if (modelo === "57") return "frete";
  const c = (cfop ?? "").trim();
  if (
    /^[123]20[1-9]$/.test(c) || /^[12]41[01]$/.test(c) || /^[12]66[0-2]$/.test(c) ||
    /^[56]20[12]$/.test(c) || /^[56]210$/.test(c) || /^[56]41[0-3]$/.test(c) || /^[56]55[36]$/.test(c) || /^[56]66[0-2]$/.test(c)
  ) {
    return "devolucao";
  }
  if (/^[1-7]15\d$/.test(c) || /^[1256]40[89]$/.test(c) || /^[1256]55[27]$/.test(c)) return "transferencia";
  if (
    /^[1-7]1\d\d$/.test(c) || /^[12]40[1-7]$/.test(c) || /^[56]40[1-5]$/.test(c) || /^[1-7]65[1-6]$/.test(c) ||
    /^[56]667$/.test(c) || /^[12]55[1-6]$/.test(c) || /^[56]551$/.test(c)
  ) {
    return "compra";
  }
  return "outras";
}

/** Destinação que o próprio CFOP de entrada já informa (notas de entrada emitidas pela empresa). */
export function destinacaoPeloCfop(cfop: string | null | undefined): Destinacao | null {
  const c = (cfop ?? "").trim();
  if (/^[12]55[1-5]$/.test(c) || /^[12]406$/.test(c)) return "ativo";
  if (/^[12]55[67]$/.test(c) || /^[12]407$/.test(c)) return "uso_consumo";
  if (/^[123]1\d\d$/.test(c) || /^[12]40[1-3]$/.test(c) || /^[123]65[1-3]$/.test(c)) return "revenda";
  return null;
}

/** Mercadoria com o ICMS já cobrado por substituição tributária (ou monofásico, como os combustíveis). */
export function itemComSt(it: ItemEntradaDados): boolean {
  if (dec(it.icms_st).gt(0) || dec(it.icms_st_retido).gt(0)) return true;
  if (it.cst && ["10", "30", "60", "61", "70"].includes(it.cst)) return true;
  if (it.csosn && ["201", "202", "203", "500"].includes(it.csosn)) return true;
  return /^[56]40[1-5]$/.test(it.cfop ?? "") || /^[12]40[1-9]$/.test(it.cfop ?? "");
}

function modoDe(dados: DadosIcms): ModoIcms {
  const r = dados.empresa.regime;
  if (r && REGIMES_SIMPLES.has(r)) return "simples";
  if (r && REGIMES_NORMAIS.has(r)) return dados.empresa.contribuinte_icms ? "normal" : "nao_contribuinte";
  return "sem_regime";
}

function vencimentoDia(comp: string, dia: number): string {
  return `${somarMeses(comp, 1).slice(0, 8)}${String(dia).padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// Entradas: destinação, valor da operação, crédito, complementação e DIFAL
// -----------------------------------------------------------------------------
interface CtxEntradas {
  dados: DadosIcms;
  modo: ModoIcms;
  uf: string | null;
  regras: RegrasIcmsUf | null;
  interna: number | null;
  reducao: number | null;
}

function calcularNota(ctx: CtxEntradas, nota: NotaEntradaDados): NotaCalculada {
  const { dados, modo, uf, regras, interna, reducao } = ctx;
  const ufEmit = (nota.emitente_uf ?? "").toUpperCase();
  const interestadual = Boolean(uf && UFS.test(ufEmit) && ufEmit !== uf);
  const escolhaFornecedor = nota.destinacao_fornecedor ?? (nota.emitente_documento ? (dados.fornecedores[nota.emitente_documento] ?? null) : null);
  const somaProdutos = nota.itens.reduce((s, i) => s.plus(dec(i.valor)), ZERO);
  const leituraCompleta = nota.leitura >= 4;
  const despesasNota = dec(nota.frete).plus(dec(nota.outros)).plus(leituraCompleta ? ZERO : dec(nota.seguro));

  const itensDados: ItemEntradaDados[] =
    nota.modelo === "57" || nota.itens.length === 0
      ? [{ n: 1, cfop: null, descricao: "Frete (CT-e)", valor: nota.valor_total, icms: nota.icms }]
      : nota.itens;

  const itens = itensDados.map((it): ItemCalculado => {
    const tipo = tipoEntrada(it.cfop, nota.modelo);
    const memoria: string[] = [];
    // Destinação: item → nota → (CFOP da própria empresa) → fornecedor → padrão
    let destinacao: Destinacao;
    let origemDestinacao: ItemCalculado["origemDestinacao"];
    const peloCfop = nota.propria ? destinacaoPeloCfop(it.cfop) : null;
    if (it.destinacao) [destinacao, origemDestinacao] = [it.destinacao, "item"];
    else if (nota.destinacao) [destinacao, origemDestinacao] = [nota.destinacao, "nota"];
    else if (tipo === "devolucao" || tipo === "frete") [destinacao, origemDestinacao] = ["revenda", "tipo"];
    else if (peloCfop) [destinacao, origemDestinacao] = [peloCfop, "cfop"];
    else if (escolhaFornecedor) [destinacao, origemDestinacao] = [escolhaFornecedor, "fornecedor"];
    else if (tipo === "outras") [destinacao, origemDestinacao] = ["nao_se_aplica", "tipo"];
    else [destinacao, origemDestinacao] = [dados.destinacao_padrao, "padrao"];

    // Valor da operação: produto − desconto + frete + seguro + outras despesas + IPI
    const valorItem = dec(it.valor);
    let despesas = dec(it.frete).plus(dec(it.seguro)).plus(dec(it.outros));
    let rateado = false;
    if (!leituraCompleta && despesasNota.gt(0) && somaProdutos.gt(0) && nota.modelo !== "57") {
      despesas = despesasNota.times(valorItem).div(somaProdutos);
      rateado = true;
    }
    const valorOperacao = nota.modelo === "57" ? dec(nota.valor_total) : Decimal.max(0, valorItem.minus(dec(it.desconto)).plus(despesas).plus(dec(it.ipi)));
    const icmsDestacado = dec(it.icms);
    const creditoSimples = dec(it.cred_sn);
    const st = nota.modelo !== "57" && itemComSt(it);
    const aliqDest = it.p_icms != null && dec(it.p_icms).gt(0) ? dec(it.p_icms).toNumber() : null;
    const importado = ORIGENS_IMPORTADAS.has(String(it.orig ?? ""));
    const aliqInter = interestadual && uf ? aliquotaInterestadual(ufEmit, uf, importado) : null;

    // Crédito (regime normal)
    let credito = ZERO;
    let semCredito: string | null = null;
    if (modo === "normal") {
      if (destinacao === "nao_se_aplica") semCredito = "Não entra no cálculo.";
      else if (tipo === "devolucao") credito = icmsDestacado;
      else if (destinacao === "revenda") {
        if (st && tipo !== "frete") semCredito = "Mercadoria com ICMS-ST: na revenda, o ICMS do fornecedor não gera crédito.";
        else credito = icmsDestacado.plus(creditoSimples);
      } else if (destinacao === "uso_consumo") semCredito = "Uso e consumo: sem crédito de ICMS até 2032 (LC 87/1996, art. 33, I).";
      else if (destinacao === "ativo") semCredito = "Ativo imobilizado: o crédito é de 1/48 por mês (CIAP); lance a parcela em “Outros créditos”.";
    }

    // Complementação de alíquota (Simples/MEI) e diferencial de alíquotas
    let complementacao = ZERO;
    let difal = ZERO;
    const entraNoCalculo = (tipo === "compra" || tipo === "outras") && !nota.propria;
    if (interestadual && entraNoCalculo && regras && interna != null && aliqInter != null && !st) {
      const dif = interna - aliqInter;
      if (modo === "simples" && destinacao === "revenda" && dif > 0 && reducao != null) {
        const base = valorOperacao.times(new Decimal(100 - reducao)).div(CEM);
        complementacao = base.times(dif).div(CEM);
        memoria.push(
          `Complementação: ${moeda(centavos(valorOperacao))}${reducao ? ` com redução de ${reducao}% na base (${moeda(centavos(base))})` : ""} × (${pctTxt(interna)} − ${pctTxt(aliqInter)}) = ${moeda(centavos(complementacao))}`,
        );
      }
      if ((modo === "simples" || modo === "normal") && (destinacao === "uso_consumo" || destinacao === "ativo") && dif > 0) {
        if (regras.difal.metodo === "base_dupla") {
          const icmsOrigem = icmsDestacado.gt(0) ? icmsDestacado : valorOperacao.times(aliqInter).div(CEM);
          const base = valorOperacao.minus(icmsOrigem).div(new Decimal(1).minus(new Decimal(interna).div(CEM)));
          difal = Decimal.max(0, base.times(interna).div(CEM).minus(icmsOrigem));
          memoria.push(
            `DIFAL (base dupla): (${moeda(centavos(valorOperacao))} − ICMS de origem ${moeda(centavos(icmsOrigem))}) ÷ (1 − ${pctTxt(interna)}) = base ${moeda(centavos(base))}; ` +
              `${moeda(centavos(base))} × ${pctTxt(interna)} − ${moeda(centavos(icmsOrigem))} = ${moeda(centavos(difal))}`,
          );
        } else {
          difal = valorOperacao.times(dif).div(CEM);
          memoria.push(`DIFAL: ${moeda(centavos(valorOperacao))} × (${pctTxt(interna)} − ${pctTxt(aliqInter)}) = ${moeda(centavos(difal))}`);
        }
      }
    }
    if (aliqInter != null && aliqDest != null && Math.abs(aliqDest - aliqInter) > 0.001 && !st) {
      memoria.push(`Alíquota destacada pelo fornecedor (${pctTxt(aliqDest)}) diferente da interestadual (${pctTxt(aliqInter)}): o cálculo usa a interestadual.`);
    }
    if (rateado) memoria.push("Frete e outras despesas da nota rateados pelo valor dos produtos (nota lida antes da leitura por item).");
    const possivelSt = interestadual && entraNoCalculo && !st && destinacao === "revenda" && Boolean(it.cest);

    return {
      n: it.n,
      descricao: it.descricao ?? null,
      cfop: it.cfop ?? null,
      ncm: it.ncm ?? null,
      tipo,
      destinacao,
      origemDestinacao,
      escolhaItem: it.destinacao ?? null,
      interestadual,
      st,
      possivelSt,
      valorOperacao,
      rateado,
      aliquotaInterestadual: aliqInter,
      aliquotaDestacada: aliqDest,
      icmsDestacado,
      creditoSimples,
      credito,
      semCredito: credito.gt(0) ? null : semCredito,
      complementacao,
      difal,
      memoria,
    };
  });

  const destinacoes = new Set(itens.map((i) => i.destinacao));
  return {
    id: nota.id,
    modelo: nota.modelo,
    numero: nota.numero,
    serie: nota.serie,
    data: nota.data,
    emitente: nota.emitente,
    emitenteDocumento: nota.emitente_documento,
    emitenteUf: nota.emitente_uf,
    propria: nota.propria,
    interestadual,
    escolhaNota: nota.destinacao,
    escolhaFornecedor,
    destinacao: destinacoes.size === 1 ? itens[0].destinacao : null,
    itens,
    valor: itens.reduce((s, i) => s.plus(i.valorOperacao), ZERO),
    credito: itens.reduce((s, i) => s.plus(i.credito), ZERO),
    complementacao: itens.reduce((s, i) => s.plus(i.complementacao), ZERO),
    difal: itens.reduce((s, i) => s.plus(i.difal), ZERO),
  };
}

// -----------------------------------------------------------------------------
// Cálculo do mês
// -----------------------------------------------------------------------------
export function calcularIcms(dados: DadosIcms): ResultadoIcms {
  const comp = `${String(dados.competencia).slice(0, 7)}-01`;
  const modo = modoDe(dados);
  const uf = dados.empresa.uf && UFS.test(dados.empresa.uf.toUpperCase()) ? dados.empresa.uf.toUpperCase() : null;
  const regras = uf ? (REGRAS_ICMS[uf] ?? null) : null;
  const interna = dados.aliquota_interna?.aliquota != null ? dec(dados.aliquota_interna.aliquota).toNumber() : null;
  const ano = Number(comp.slice(0, 4));
  const reducao = regras ? reducaoComplementacao(regras, ano) : null;
  const avisos: string[] = [];
  const fontes: Fonte[] = [];
  const addFonte = (f: Fonte) => {
    if (!fontes.some((x) => x.titulo === f.titulo)) fontes.push(f);
  };
  const regimeRotulo = dados.empresa.regime ? (REGIMES[dados.empresa.regime] ?? dados.empresa.regime) : "Regime não informado";
  const venc = (dia?: number) => (dia ? vencimentoDia(comp, dia) : null);
  const vencTexto = regras ? regras.vencimento.texto : "conforme o calendário fiscal do estado";

  const base: ResultadoIcms = {
    competencia: comp,
    mesPagamento: somarMeses(comp, 1),
    regime: dados.empresa.regime,
    regimeRotulo,
    uf,
    modo,
    mensagem: null,
    regras,
    aliquotaInterna: interna,
    propria: null,
    linhas: [],
    totalGuias: ZERO,
    notas: [],
    resumoEntradas: { notas: 0, interestaduais: 0, itensPadrao: 0, itensRateados: 0, possivelSt: 0, ativoIcms: ZERO },
    comparacaoSped: null,
    avisos,
    fontes,
  };

  if (modo === "sem_regime") {
    return { ...base, mensagem: `A apuração automática do ICMS não está disponível para o regime ${regimeRotulo}. Informe o regime da empresa em Obrigações e prazos → Empresas.` };
  }
  if (modo === "nao_contribuinte") {
    const icmsSaidas = dados.saidas.reduce((s, x) => s.plus(dec(x.icms)), ZERO);
    if (icmsSaidas.gt(0)) {
      avisos.push(`Há ICMS destacado nas vendas (${moeda(icmsSaidas)}), mas a empresa está marcada como não contribuinte do ICMS. Confira a inscrição estadual no cadastro.`);
    }
    return {
      ...base,
      mensagem:
        "A empresa está marcada como não contribuinte do ICMS (sem inscrição estadual). Nas compras de outros estados para consumo, o diferencial é recolhido pelo fornecedor.",
    };
  }

  if (!uf) avisos.push("A empresa está sem estado (UF) no cadastro: as alíquotas interestaduais não podem ser calculadas.");
  else if (!regras) {
    avisos.push(
      `As regras de complementação de alíquota e de diferencial de alíquotas de ${uf} ainda não estão cadastradas no portal: calcule-as à parte e lance como “Outra guia de ICMS”.`,
    );
  }
  if (regras && interna == null) avisos.push(`A alíquota interna de ${uf} não está conferida na tabela “ICMS por estado”: a complementação e o diferencial não foram calculados.`);
  if (regras && modo === "simples" && reducao === null) {
    avisos.push(`A redução da base da complementação de alíquota para ${ano} não está cadastrada: confira a Lei nº 1.303/2002 (TO).`);
  }

  // Entradas
  const ctx: CtxEntradas = { dados, modo, uf, regras, interna, reducao };
  const notas = dados.entradas.map((n) => calcularNota(ctx, n));
  const todosItens = notas.flatMap((n) => n.itens);
  base.resumoEntradas = {
    notas: notas.length,
    interestaduais: notas.filter((n) => n.interestadual && !n.propria).length,
    itensPadrao: notas.filter((n) => n.interestadual || modo === "normal").flatMap((n) => n.itens).filter((i) => i.origemDestinacao === "padrao").length,
    itensRateados: todosItens.filter((i) => i.rateado && (i.complementacao.gt(0) || i.difal.gt(0))).length,
    possivelSt: todosItens.filter((i) => i.possivelSt).length,
    ativoIcms: todosItens.filter((i) => i.destinacao === "ativo" && i.tipo !== "devolucao").reduce((s, i) => s.plus(i.icmsDestacado), ZERO),
  };

  const lanc = (t: TipoLancamentoIcms) => dados.lancamentos.filter((l) => l.tipo === t).reduce((s, l) => s.plus(dec(l.valor)), ZERO);
  const linhas: LinhaIcms[] = [];
  const addLinha = (l: LinhaIcms) => {
    if (l.valor.gt(0)) linhas.push({ ...l, valor: centavos(l.valor) });
  };

  // ---------------------------------------------------------------------------
  // Regime normal: apuração do ICMS próprio
  // ---------------------------------------------------------------------------
  if (modo === "normal") {
    const debitosPorCfop = dados.saidas.map((s) => {
      const excluido = /^[56]929$/.test(s.cfop)
        ? "NF-e emitida em lugar de cupom fiscal já registrado: o ICMS já está no cupom (NFC-e/ECF)."
        : null;
      return { cfop: s.cfop, notas: s.notas, valor: dec(s.valor), base: dec(s.base), icms: dec(s.icms), excluido };
    });
    const debitos = debitosPorCfop.filter((d) => !d.excluido).reduce((s, d) => s.plus(d.icms), ZERO);

    const grupos = new Map<string, { chave: string; rotulo: string; icms: Decimal; creditado: boolean }>();
    const somarGrupo = (chave: string, rotulo: string, icms: Decimal, creditado: boolean) => {
      if (icms.isZero()) return;
      const g = grupos.get(chave) ?? { chave, rotulo, icms: ZERO, creditado };
      g.icms = g.icms.plus(icms);
      grupos.set(chave, g);
    };
    for (const it of todosItens) {
      const icms = it.icmsDestacado.plus(it.creditoSimples);
      if (it.credito.gt(0)) {
        const rotulo =
          it.tipo === "devolucao"
            ? "Devoluções de vendas"
            : it.tipo === "frete"
              ? "Fretes (CT-e)"
              : it.tipo === "transferencia"
                ? "Transferências recebidas"
                : "Compras para revenda ou industrialização";
        somarGrupo(`cred:${rotulo}`, rotulo, it.credito, true);
        if (it.creditoSimples.gt(0)) somarGrupo("info:sn", "— dos quais crédito de fornecedores do Simples (CSOSN 101/201/900)", it.creditoSimples, false);
      } else if (icms.gt(0)) {
        const rotulo =
          it.destinacao === "uso_consumo"
            ? "Uso e consumo (sem crédito)"
            : it.destinacao === "ativo"
              ? "Ativo imobilizado (crédito pelo CIAP, 1/48 por mês)"
              : it.st
                ? "Mercadorias com ICMS-ST (sem crédito na revenda)"
                : "Entradas que não entram no cálculo";
        somarGrupo(`sem:${rotulo}`, rotulo, icms, false);
      }
    }
    const creditos = todosItens.reduce((s, i) => s.plus(i.credito), ZERO);
    const outrosDebitos = lanc("outro_debito");
    const estornosCredito = lanc("estorno_credito");
    const outrosCreditos = lanc("outro_credito");
    const estornosDebito = lanc("estorno_debito");
    const deducoes = lanc("deducao");

    // Saldo credor do mês anterior
    let saldoAnterior = ZERO;
    let origemSaldo: ApuracaoPropria["origemSaldo"] = "sem_informacao";
    if (dados.apuracao?.saldo_credor_anterior != null) {
      saldoAnterior = dec(dados.apuracao.saldo_credor_anterior);
      origemSaldo = "informado";
    } else if (dados.anterior?.conferida) {
      saldoAnterior = dec(dados.anterior.saldo_credor_transportar);
      origemSaldo = "mes_anterior";
    } else {
      avisos.push(
        `Saldo credor de ${formatarCompetencia(somarMeses(comp, -1), true)}: o mês anterior não foi conferido no portal. Se havia saldo credor, informe-o (ou confira o mês anterior); sem isso, foi considerado zero.`,
      );
    }

    const totalDebitos = debitos.plus(outrosDebitos).plus(estornosCredito);
    const totalCreditos = creditos.plus(outrosCreditos).plus(estornosDebito).plus(saldoAnterior);
    const saldo = totalDebitos.minus(totalCreditos);
    const saldoDevedor = Decimal.max(0, saldo);
    const aRecolher = Decimal.max(0, saldoDevedor.minus(deducoes));
    const saldoCredorTransportar = saldo.lt(0) ? saldo.abs() : ZERO;
    base.propria = {
      debitos: centavos(debitos),
      outrosDebitos,
      estornosCredito,
      creditos: centavos(creditos),
      outrosCreditos,
      estornosDebito,
      saldoAnterior,
      origemSaldo,
      saldoDevedor: centavos(saldoDevedor),
      deducoes,
      aRecolher: centavos(aRecolher),
      saldoCredorTransportar: centavos(saldoCredorTransportar),
      debitosPorCfop,
      creditosPorGrupo: [...grupos.values()].sort((a, b) => Number(b.creditado) - Number(a.creditado) || a.rotulo.localeCompare(b.rotulo)),
    };
    const vencIcms = dados.vencimentos.find((v) => v.codigo === "ICMS")?.vencimento ?? null;
    const detalhes = [
      `Débitos (ICMS das vendas e demais saídas): ${moeda(centavos(debitos))}`,
      ...(outrosDebitos.gt(0) ? [`(+) Outros débitos: ${moeda(outrosDebitos)}`] : []),
      ...(estornosCredito.gt(0) ? [`(+) Estornos de crédito: ${moeda(estornosCredito)}`] : []),
      `(−) Créditos das entradas: ${moeda(centavos(creditos))}`,
      ...(outrosCreditos.gt(0) ? [`(−) Outros créditos: ${moeda(outrosCreditos)}`] : []),
      ...(estornosDebito.gt(0) ? [`(−) Estornos de débito: ${moeda(estornosDebito)}`] : []),
      ...(saldoAnterior.gt(0) ? [`(−) Saldo credor do mês anterior: ${moeda(saldoAnterior)}`] : []),
      ...(deducoes.gt(0) ? [`(−) Deduções: ${moeda(deducoes)}`] : []),
      ...(saldoCredorTransportar.gt(0) ? [`Saldo credor para o mês seguinte: ${moeda(centavos(saldoCredorTransportar))}`] : []),
    ];
    if (aRecolher.gt(0)) {
      addLinha({
        chave: "icms_proprio",
        titulo: "ICMS apurado (operações próprias)",
        guia: "DARE",
        valor: aRecolher,
        detalhes,
        vencimento: vencIcms ?? venc(regras?.vencimento.dia),
        vencimentoTexto: vencIcms ? "prazo da obrigação ICMS" : vencTexto,
      });
    }
    if (saldoCredorTransportar.gt(0)) {
      avisos.push(`Créditos maiores que os débitos: não há ICMS próprio a pagar e o saldo credor de ${moeda(centavos(saldoCredorTransportar))} passa para o mês seguinte.`);
    }
    if (base.resumoEntradas.ativoIcms.gt(0)) {
      avisos.push(
        `Compras para o ativo imobilizado com ICMS de ${moeda(centavos(base.resumoEntradas.ativoIcms))}: o crédito é feito em 48 parcelas (CIAP). Lance a parcela do mês em “Outros créditos”.`,
      );
    }
    if (debitosPorCfop.some((d) => d.excluido)) {
      avisos.push("Notas com CFOP 5.929/6.929 (emitidas em lugar de cupom fiscal) não foram somadas aos débitos, para não contar o ICMS duas vezes.");
    }
    const fcp = dec(dados.saidas_totais?.fcp);
    if (fcp.gt(0)) {
      addLinha({
        chave: "fcp",
        titulo: "Adicional de fundo de combate à pobreza (FCP) das vendas",
        guia: "DARE",
        valor: fcp,
        detalhes: [`FCP destacado nas notas de saída do mês: ${moeda(fcp)}`],
        vencimento: null,
        vencimentoTexto: "conforme o calendário fiscal do estado",
      });
    }
    avisos.push(
      "Créditos de energia elétrica, comunicação e CIAP, e notas sem XML no portal, não entram automaticamente: lance-os em “Outros créditos” quando houver direito.",
    );
  } else {
    // Simples/MEI: lançamentos da apuração própria não se aplicam
    if (dados.lancamentos.some((l) => TIPOS_LANCAMENTO_ICMS[l.tipo].regimeNormal)) {
      avisos.push("Há lançamentos de débito/crédito da apuração própria neste mês, que não se aplicam ao Simples Nacional: eles não foram considerados.");
    }
    avisos.push("O ICMS das vendas do Simples Nacional está dentro do DAS (veja a previsão de impostos); aqui estão só os valores pagos em guia à parte.");
  }

  // ---------------------------------------------------------------------------
  // Guias à parte (Simples e regime normal)
  // ---------------------------------------------------------------------------
  const complementacao = notas.reduce((s, n) => s.plus(n.complementacao), ZERO);
  const difal = notas.reduce((s, n) => s.plus(n.difal), ZERO);
  const comItens = (campo: "complementacao" | "difal") =>
    notas
      .filter((n) => n[campo].gt(0))
      .map((n) => `NF-e ${n.numero ?? "s/n"}${n.emitente ? ` — ${n.emitente}` : ""} (${n.emitenteUf}): ${moeda(centavos(n[campo]))}`);
  if (regras) {
    if (modo === "simples") {
      for (const f of regras.complementacao.fontes) addFonte(f);
      addLinha({
        chave: "complementacao",
        titulo: "ICMS — complementação de alíquota (compras de outros estados para revenda)",
        guia: "DARE",
        valor: complementacao,
        detalhes: [
          reducao
            ? `Diferença entre a alíquota interna (${pctTxt(interna ?? 0)}) e a interestadual, sobre o valor das compras com redução de ${reducao}% na base (${ano}).`
            : `Diferença entre a alíquota interna (${pctTxt(interna ?? 0)}) e a interestadual, sobre o valor das compras.`,
          ...comItens("complementacao"),
          "Não se aplica a mercadorias com ICMS-ST nem a uso e consumo ou ativo. Não gera crédito.",
        ],
        vencimento: venc(regras.vencimento.dia),
        vencimentoTexto: vencTexto,
      });
    }
    if (difal.gt(0)) for (const f of regras.difal.fontes) addFonte(f);
    addLinha({
      chave: "difal",
      titulo: "ICMS — diferencial de alíquotas (uso e consumo / ativo de outros estados)",
      guia: "DARE",
      valor: difal,
      detalhes: [
        regras.difal.metodo === "base_dupla"
          ? `Base dupla: o ICMS do destino (${pctTxt(interna ?? 0)}) entra na própria base; desconta-se o ICMS da origem.`
          : `Diferença entre a alíquota interna (${pctTxt(interna ?? 0)}) e a interestadual, sobre o valor da compra.`,
        ...comItens("difal"),
      ],
      vencimento: venc(regras.vencimento.dia),
      vencimentoTexto: vencTexto,
    });
    if (complementacao.gt(0) || difal.gt(0) || linhas.some((l) => l.chave === "icms_proprio")) for (const f of regras.vencimento.fontes) addFonte(f);
  }
  const icmsSt = dec(dados.saidas_totais?.icms_st);
  addLinha({
    chave: "st_vendas",
    titulo: "ICMS-ST retido nas vendas (substituto tributário)",
    guia: "DARE/GNRE",
    valor: icmsSt,
    detalhes: [`ICMS-ST destacado nas notas de saída do mês: ${moeda(icmsSt)}`, "Nas vendas para outro estado, a guia é do estado de destino (GNRE), salvo inscrição de substituto lá."],
    vencimento: null,
    vencimentoTexto: "conforme o calendário fiscal / a cada venda (GNRE)",
  });
  const difalDestino = dec(dados.saidas_totais?.difal_destino).plus(dec(dados.saidas_totais?.fcp_destino));
  addLinha({
    chave: "difal_vendas",
    titulo: "DIFAL das vendas a consumidor final de outro estado",
    guia: "GNRE",
    valor: difalDestino,
    detalhes: [
      `ICMS do estado de destino (vICMSUFDest${dec(dados.saidas_totais?.fcp_destino).gt(0) ? " + FCP" : ""}) nas notas do mês: ${moeda(difalDestino)}`,
      "Pago ao estado de destino por GNRE a cada venda (ou no prazo do estado, se a empresa tiver inscrição lá).",
    ],
    vencimento: null,
    vencimentoTexto: "a cada venda (GNRE)",
  });
  for (const l of dados.lancamentos.filter((x) => x.tipo === "guia_extra")) {
    addLinha({
      chave: `extra:${l.id}`,
      titulo: l.descricao,
      guia: "Lançado pelo escritório",
      valor: dec(l.valor),
      detalhes: l.observacao ? [l.observacao] : [],
      vencimento: null,
      vencimentoTexto: "conforme a guia",
    });
  }

  // Pontos de atenção das entradas
  const r = base.resumoEntradas;
  if (dados.leitura_antiga > 0) {
    avisos.push(
      `${dados.leitura_antiga} ${dados.leitura_antiga === 1 ? "nota do mês foi lida" : "notas do mês foram lidas"} antes da leitura completa (frete por item, crédito do Simples, DIFAL de destino). Use “Atualizar a leitura das notas” para recalcular com todos os dados.`,
    );
  }
  if (r.itensPadrao > 0 && (modo === "normal" || r.interestaduais > 0)) {
    avisos.push(
      `${r.itensPadrao} ${r.itensPadrao === 1 ? "item usa" : "itens usam"} a destinação padrão da empresa (${DESTINACOES[dados.destinacao_padrao].rotulo.toLowerCase()}). Confira as notas de entrada e marque o que for uso e consumo ou ativo.`,
    );
  }
  if (r.possivelSt > 0) {
    avisos.push(
      `${r.possivelSt} ${r.possivelSt === 1 ? "item comprado" : "itens comprados"} de outro estado com código CEST e sem ICMS-ST retido: confira se a mercadoria está sujeita à substituição tributária no estado. Se estiver, o ICMS-ST da entrada é devido (lance como “Outra guia de ICMS”) e a complementação não se aplica.`,
    );
  }
  if (modo === "simples" && !dados.empresa.contribuinte_icms && (complementacao.gt(0) || difal.gt(0))) {
    avisos.push("A empresa está marcada como não contribuinte do ICMS no cadastro, mas compra mercadorias de outros estados: confira a inscrição estadual.");
  }
  if (dados.aliquota_interna && dados.aliquota_interna.situacao !== "conferida") {
    avisos.push(`A alíquota interna de ${uf} está “${dados.aliquota_interna.situacao === "informada" ? "informada pelo estado" : "a conferir"}” na tabela ICMS por estado.`);
  }
  if (dados.aliquota_interna?.base_legal) addFonte({ titulo: `Alíquota interna de ${uf}: ${dados.aliquota_interna.base_legal}`, url: dados.aliquota_interna.fonte_url ?? undefined });
  if (complementacao.gt(0) || difal.gt(0)) addFonte({ titulo: "Alíquotas interestaduais — Resoluções do Senado nº 22/1989 e nº 13/2012" });
  if (modo === "normal") addFonte({ titulo: "Lei Complementar nº 87/1996 (Lei Kandir) — não cumulatividade e créditos", url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm" });

  // Comparação com a EFD (E110)
  if (modo === "normal" && base.propria && dados.sped?.apuracao) {
    const s = dados.sped.apuracao;
    const p = base.propria;
    const linha = (rotulo: string, portal: Decimal, sped: Num): ComparacaoSped => {
      const v = centavos(dec(sped));
      return { rotulo, portal: centavos(portal), sped: v, diferente: centavos(portal).minus(v).abs().gte("0.05") };
    };
    base.comparacaoSped = [
      linha("Débitos", p.debitos, s.debitos),
      linha("Outros débitos (ajustes)", p.outrosDebitos, s.ajustes_debito),
      linha("Estornos de crédito", p.estornosCredito, s.estornos_credito),
      linha("Créditos", p.creditos, s.creditos),
      linha("Outros créditos (ajustes)", p.outrosCreditos, s.ajustes_credito),
      linha("Estornos de débito", p.estornosDebito, s.estornos_debito),
      linha("Saldo credor do mês anterior", p.saldoAnterior, s.saldo_credor_anterior),
      linha("Deduções", p.deducoes, s.deducoes),
      linha("ICMS a recolher", p.aRecolher, s.a_recolher),
      linha("Saldo credor a transportar", p.saldoCredorTransportar, s.saldo_credor_transportar),
    ];
    if (base.comparacaoSped.some((c) => c.diferente)) {
      avisos.push("A apuração do portal difere da EFD ICMS/IPI enviada (registro E110). Veja a comparação e confira notas sem XML, CFOP e lançamentos.");
    }
  }

  const totalGuias = linhas.reduce((s, l) => s.plus(l.valor), ZERO);
  return { ...base, notas, linhas, totalGuias: centavos(totalGuias), avisos: [...new Set(avisos)] };
}

/** Resultado guardado na conferência (somente valores, sem as notas). */
export function resultadoParaGuardar(r: ResultadoIcms): ResultadoGuardado {
  const p = r.propria;
  return {
    versao: 1,
    a_recolher: (p?.aRecolher ?? ZERO).toFixed(2),
    saldo_credor_transportar: (p?.saldoCredorTransportar ?? ZERO).toFixed(2),
    total_guias: r.totalGuias.toFixed(2),
    saldo_anterior: (p?.saldoAnterior ?? ZERO).toFixed(2),
    modo: r.modo,
    linhas: r.linhas.map((l) => ({ chave: l.chave, titulo: l.titulo, guia: l.guia, valor: l.valor.toFixed(2), vencimento: l.vencimento })),
    propria: p
      ? {
          debitos: p.debitos.toFixed(2),
          outros_debitos: p.outrosDebitos.toFixed(2),
          estornos_credito: p.estornosCredito.toFixed(2),
          creditos: p.creditos.toFixed(2),
          outros_creditos: p.outrosCreditos.toFixed(2),
          estornos_debito: p.estornosDebito.toFixed(2),
          saldo_anterior: p.saldoAnterior.toFixed(2),
          deducoes: p.deducoes.toFixed(2),
        }
      : null,
  };
}

/** A apuração atual difere da conferida? (guias, ICMS a recolher ou saldo credor) */
export function mudouDesdeConferencia(r: ResultadoIcms, guardado: ResultadoGuardado | null | undefined): boolean {
  if (!guardado) return false;
  const atual = resultadoParaGuardar(r);
  return atual.total_guias !== guardado.total_guias || atual.a_recolher !== guardado.a_recolher || atual.saldo_credor_transportar !== guardado.saldo_credor_transportar;
}
