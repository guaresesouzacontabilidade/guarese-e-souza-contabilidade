import Decimal from "decimal.js";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { avos13NoAno, diasTrabalhadosNoMes, inssEmpregado, irrf13, irrfMensal } from "./folha";
import {
  ANEXOS_SIMPLES,
  CBS_IBS_2026,
  FOLHA,
  FONTE_SIMPLES,
  INSS_EMPREGADO,
  IRPJ_CSLL,
  IRRF,
  LC224,
  MEI,
  PIS_COFINS,
  PRIMEIRA_COMPETENCIA,
  SALARIO_MINIMO,
  SIMPLES,
  vigente,
  type Anexo,
  type Fonte,
} from "./tabelas";

// -----------------------------------------------------------------------------
// Dados recebidos do banco (public.dados_previsao_impostos)
// -----------------------------------------------------------------------------
type Num = number | string | null | undefined;

export interface MesDados {
  competencia: string;
  vendas: Num;
  vendas_st: Num;
  icms_vendas: Num;
  servicos_nfe: Num;
  devolucoes: Num;
  icms_devolucoes: Num;
  compras: Num;
  icms_compras: Num;
  servicos: Num;
  servicos_retido: Num;
  iss_destacado: Num;
  servicos_sem_iss: Num;
  iss_retido: Num;
  icms_debito: Num;
  icms_credito: Num;
  ipi_debito: Num;
  ipi_credito: Num;
  notas_saida: number;
  notas_entrada: number;
  informado: { receita_mercadorias: Num; receita_servicos: Num; folha_fator_r: Num; observacao: string | null } | null;
}

export interface ParametrosCalculo {
  empresa_id?: string;
  inicio_atividade: string | null;
  mei_atividade: "comercio_industria" | "servicos" | "comercio_servicos" | "caminhoneiro" | null;
  anexo_mercadorias: "I" | "II";
  anexo_servicos: "III" | "IV" | "V";
  fator_r: boolean;
  presuncao_irpj_mercadorias: Num;
  presuncao_irpj_servicos: Num;
  presuncao_csll_mercadorias: Num;
  presuncao_csll_servicos: Num;
  acrescimo_lc224: boolean;
  creditos_pis_cofins: boolean;
  aliquota_iss: Num;
  calcular_icms: boolean;
  calcular_ipi: boolean;
  rat: Num;
  fap: Num;
  terceiros: Num;
  pro_labore: Num;
  socios_pro_labore: number;
  updated_at?: string;
}

export interface ColaboradorFolha {
  admissao: string;
  desligamento: string | null;
  salario: Num;
  adicionais: Num;
  dependentes_ir: number;
}

export interface DadosPrevisao {
  competencia: string;
  empresa: {
    nome: string;
    regime: string | null;
    lucro_real_apuracao: "trimestral" | "anual" | null;
    contribuinte_icms: boolean;
    contribuinte_iss: boolean;
    tem_empregados: boolean;
    tem_pro_labore: boolean;
    uf: string | null;
  };
  parametros: ParametrosCalculo | null;
  meses: MesDados[];
  checklist: { itens: number; obrigatorios: number; faltantes: { titulo: string; status: string; prazo: string }[] } | null;
  colaboradores: ColaboradorFolha[];
  ajustes: { id: string; descricao: string; valor: Num; observacao: string | null }[];
  vencimentos: { codigo: string; vencimento: string | null; valor_guia: Num; concluida: boolean }[];
  guias_publicadas: number;
}

// -----------------------------------------------------------------------------
// Resultado
// -----------------------------------------------------------------------------
export interface LinhaPrevisao {
  chave: string;
  tributo: string;
  guia: string;
  /** "pagar": vence no mês seguinte à competência; "provisao": reserva para pagamento futuro (ex.: fim do trimestre). */
  grupo: "pagar" | "provisao";
  valor: Decimal;
  detalhes: string[];
  obrigacao?: string;
  vencimento?: string | null;
  valorGuia?: Decimal | null;
}

export type SituacaoPrevisao = "ok" | "sem_parametros" | "regime_nao_suportado" | "competencia_nao_suportada";

export interface Previsao {
  competencia: string;
  /** Mês em que os tributos da competência são pagos. */
  mesPagamento: string;
  regime: string | null;
  regimeRotulo: string;
  situacao: SituacaoPrevisao;
  mensagem: string | null;
  receita: { mercadorias: Decimal; servicos: Decimal; total: Decimal; fonte: "notas" | "informada" | "sem_dados"; notas: number };
  linhas: LinhaPrevisao[];
  totalPagar: Decimal;
  totalProvisao: Decimal;
  memoria: { rotulo: string; valor: string }[];
  avisos: string[];
  fontes: Fonte[];
  checklist: { completo: boolean; semChecklist: boolean; faltantes: { titulo: string; status: string; prazo: string }[] };
  guiasPublicadas: number;
}

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------
const CEM = new Decimal(100);

/** Percentual com vírgula (ex.: 0.0532 → "5,32%"). */
export function pct(fracao: Decimal, casas = 2): string {
  return `${fracao.times(100).toFixed(casas).replace(".", ",")}%`;
}

function pctNum(valor: Num, casas = 2): string {
  return `${dec(valor).toFixed(casas).replace(/\.?0+$/, "").replace(".", ",")}%`;
}

const moeda = (v: Decimal) => formatarMoeda(v);

export interface ReceitaMes {
  mercadorias: Decimal;
  servicos: Decimal;
  total: Decimal;
  fonte: "notas" | "informada" | "sem_dados";
  vendasSt: Decimal;
  servicosRetido: Decimal;
  icmsVendas: Decimal;
  notas: number;
}

export function receitaDoMes(m: MesDados | undefined): ReceitaMes {
  const zero = new Decimal(0);
  if (!m) return { mercadorias: zero, servicos: zero, total: zero, fonte: "sem_dados", vendasSt: zero, servicosRetido: zero, icmsVendas: zero, notas: 0 };
  const notasMerc = Decimal.max(0, dec(m.vendas).minus(dec(m.devolucoes)));
  const notasServ = dec(m.servicos).plus(dec(m.servicos_nfe));
  const icmsVendas = Decimal.max(0, dec(m.icms_vendas).minus(dec(m.icms_devolucoes)));
  const inf = m.informado;
  if (inf && (inf.receita_mercadorias != null || inf.receita_servicos != null)) {
    const merc = dec(inf.receita_mercadorias);
    const serv = dec(inf.receita_servicos);
    return {
      mercadorias: merc,
      servicos: serv,
      total: merc.plus(serv),
      fonte: "informada",
      vendasSt: Decimal.min(dec(m.vendas_st), merc),
      servicosRetido: Decimal.min(dec(m.servicos_retido), serv),
      icmsVendas: Decimal.min(icmsVendas, merc),
      notas: m.notas_saida,
    };
  }
  if (m.notas_saida === 0 && notasMerc.isZero() && notasServ.isZero()) {
    return { mercadorias: zero, servicos: zero, total: zero, fonte: "sem_dados", vendasSt: zero, servicosRetido: zero, icmsVendas: zero, notas: 0 };
  }
  return {
    mercadorias: notasMerc,
    servicos: notasServ,
    total: notasMerc.plus(notasServ),
    fonte: "notas",
    vendasSt: Decimal.min(dec(m.vendas_st), notasMerc),
    servicosRetido: Decimal.min(dec(m.servicos_retido), notasServ),
    icmsVendas: Decimal.min(icmsVendas, notasMerc),
    notas: m.notas_saida,
  };
}

interface Remuneracao {
  valor: Decimal;
  dependentes: number;
  colaborador: ColaboradorFolha;
}

export function folhaDoMes(dados: DadosPrevisao, comp: string): { remuneracoes: Remuneracao[]; total: Decimal } {
  const remuneracoes: Remuneracao[] = [];
  for (const c of dados.colaboradores) {
    const dias = diasTrabalhadosNoMes(comp, c.admissao, c.desligamento);
    if (dias <= 0) continue;
    const valor = centavos(dec(c.salario).plus(dec(c.adicionais)).times(dias).div(30));
    remuneracoes.push({ valor, dependentes: c.dependentes_ir ?? 0, colaborador: c });
  }
  return { remuneracoes, total: remuneracoes.reduce((s, r) => s.plus(r.valor), new Decimal(0)) };
}

export function proLabores(p: ParametrosCalculo): Decimal[] {
  const total = dec(p.pro_labore);
  if (total.lte(0)) return [];
  const n = Math.max(1, p.socios_pro_labore || 1);
  const cada = centavos(total.div(n));
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total.minus(cada.times(n - 1)) : cada));
}

function compDe(data: string | null | undefined): string | null {
  return data && /^\d{4}-\d{2}/.test(data) ? `${data.slice(0, 7)}-01` : null;
}

// -----------------------------------------------------------------------------
// Contexto do cálculo
// -----------------------------------------------------------------------------
interface Ctx {
  dados: DadosPrevisao;
  p: ParametrosCalculo;
  comp: string;
  mes: (c: string) => MesDados | undefined;
  receita: ReceitaMes;
  linhas: LinhaPrevisao[];
  avisos: string[];
  memoria: { rotulo: string; valor: string }[];
  fontes: Fonte[];
}

function addFonte(ctx: Ctx, f: Fonte) {
  if (!ctx.fontes.some((x) => x.titulo === f.titulo)) ctx.fontes.push(f);
}

function addLinha(ctx: Ctx, l: Omit<LinhaPrevisao, "valor"> & { valor: Decimal }) {
  ctx.linhas.push({ ...l, valor: centavos(l.valor) });
}

// -----------------------------------------------------------------------------
// MEI
// -----------------------------------------------------------------------------
function calcularMei(ctx: Ctx) {
  const { p, comp } = ctx;
  const sm = vigente(SALARIO_MINIMO, comp);
  if (sm.aviso) ctx.avisos.push(sm.aviso);
  addFonte(ctx, MEI.fonte);
  addFonte(ctx, sm.fonte);
  if (!p.mei_atividade) {
    ctx.avisos.push("Defina a atividade do MEI (comércio/indústria, serviços ou ambos) em Configuração para calcular o DAS-MEI.");
  } else {
    const caminhoneiro = p.mei_atividade === "caminhoneiro";
    const inss = centavos(dec(sm.dados).times(caminhoneiro ? MEI.inssCaminhoneiro : MEI.inssPercentual).div(CEM));
    const icms = ["comercio_industria", "comercio_servicos", "caminhoneiro"].includes(p.mei_atividade) ? dec(MEI.icms) : new Decimal(0);
    const iss = ["servicos", "comercio_servicos"].includes(p.mei_atividade) ? dec(MEI.iss) : new Decimal(0);
    const detalhes = [`INSS (${caminhoneiro ? MEI.inssCaminhoneiro : MEI.inssPercentual}% do salário mínimo de ${moeda(dec(sm.dados))}): ${moeda(inss)}`];
    if (icms.gt(0)) detalhes.push(`ICMS: ${moeda(icms)}`);
    if (iss.gt(0)) detalhes.push(`ISS: ${moeda(iss)}`);
    detalhes.push("Valor fixo: não depende do faturamento do mês.");
    addLinha(ctx, { chave: "das_mei", tributo: "DAS-MEI", guia: "DAS", grupo: "pagar", valor: inss.plus(icms).plus(iss), detalhes, obrigacao: "MEI_DAS" });
  }

  // Limite anual de faturamento
  const ano = Number(comp.slice(0, 4));
  const inicio = compDe(p.inicio_atividade);
  let receitaAno = new Decimal(0);
  for (let m = 1; m <= Number(comp.slice(5, 7)); m++) {
    receitaAno = receitaAno.plus(receitaDoMes(ctx.mes(`${ano}-${String(m).padStart(2, "0")}-01`)).total);
  }
  const mesesNoAno = inicio && inicio.slice(0, 4) === String(ano) ? 12 - Number(inicio.slice(5, 7)) + 1 : 12;
  const limite = dec(MEI.limiteAnual).times(mesesNoAno).div(12);
  ctx.memoria.push({ rotulo: `Faturamento no ano até ${formatarCompetencia(comp)}`, valor: moeda(receitaAno) });
  ctx.memoria.push({ rotulo: "Limite anual do MEI", valor: moeda(limite) });
  if (receitaAno.gt(limite.times("1.2"))) {
    ctx.avisos.push(
      `O faturamento do ano (${moeda(receitaAno)}) passou mais de 20% do limite do MEI (${moeda(limite)}): a empresa é desenquadrada desde janeiro e passa a pagar pelo Simples Nacional. Fale com o escritório.`,
    );
  } else if (receitaAno.gt(limite)) {
    ctx.avisos.push(
      `O faturamento do ano (${moeda(receitaAno)}) passou do limite do MEI (${moeda(limite)}): o excesso gera um DAS complementar e a empresa passa ao Simples Nacional no ano seguinte.`,
    );
  }
}

// -----------------------------------------------------------------------------
// Simples Nacional
// -----------------------------------------------------------------------------
function aliquotaEfetiva(anexo: Anexo, rbt12: Decimal) {
  const faixas = ANEXOS_SIMPLES[anexo];
  let i = faixas.findIndex((f) => rbt12.lte(f.ate));
  if (i < 0) i = faixas.length - 1;
  const f = faixas[i];
  const nominal = dec(f.aliquota).div(CEM);
  const efetiva = rbt12.lte(0) ? nominal : Decimal.max(0, rbt12.times(nominal).minus(f.deduzir).div(rbt12));
  return { efetiva, nominal, faixa: i + 1, dados: f };
}

function receita12Meses(ctx: Ctx) {
  const { comp, p } = ctx;
  const inicio = compDe(p.inicio_atividade);
  const anteriores = Array.from({ length: 12 }, (_, i) => somarMeses(comp, i - 12)).filter((m) => !inicio || m >= inicio);
  const folhaMes = (c: string) => {
    const inf = ctx.mes(c)?.informado?.folha_fator_r;
    if (inf != null) return { valor: dec(inf), estimada: false };
    const f = folhaDoMes(ctx.dados, c).total.times("1.08");
    return { valor: f.plus(dec(p.pro_labore)), estimada: true };
  };

  if (inicio && inicio === comp) {
    const r = ctx.receita.total;
    const f = folhaMes(comp);
    return {
      rbt12: r.times(12),
      folha12: f.valor.times(12),
      folhaEstimada: f.estimada,
      semDados: [] as string[],
      observacao: "Primeiro mês de atividade: receita do mês × 12.",
    };
  }
  let soma = new Decimal(0);
  let somaFolha = new Decimal(0);
  let folhaEstimada = false;
  const semDados: string[] = [];
  for (const m of anteriores) {
    const r = receitaDoMes(ctx.mes(m));
    if (r.fonte === "sem_dados") semDados.push(m);
    soma = soma.plus(r.total);
    const f = folhaMes(m);
    somaFolha = somaFolha.plus(f.valor);
    if (f.estimada) folhaEstimada = true;
  }
  if (anteriores.length > 0 && anteriores.length < 12) {
    return {
      rbt12: soma.div(anteriores.length).times(12),
      folha12: somaFolha.div(anteriores.length).times(12),
      folhaEstimada,
      semDados,
      observacao: `Empresa com ${anteriores.length} ${anteriores.length === 1 ? "mês" : "meses"} de atividade: média mensal × 12.`,
    };
  }
  return { rbt12: soma, folha12: somaFolha, folhaEstimada, semDados, observacao: null as string | null };
}

function calcularSimples(ctx: Ctx) {
  const { p, receita } = ctx;
  addFonte(ctx, FONTE_SIMPLES);
  const r12 = receita12Meses(ctx);
  const rbt12 = centavos(r12.rbt12);
  ctx.memoria.push({ rotulo: "Receita bruta dos 12 meses anteriores (RBT12)", valor: moeda(rbt12) });
  if (r12.observacao) ctx.memoria.push({ rotulo: "Cálculo da RBT12", valor: r12.observacao });
  if (r12.semDados.length > 0) {
    ctx.avisos.push(
      `Sem receita registrada em ${r12.semDados.length} dos meses anteriores (${r12.semDados.map((m) => formatarCompetencia(m)).join(", ")}). ` +
        "Se a empresa já faturava, o escritório deve informar a receita desses meses em Cálculos → Configuração; sem isso a alíquota pode ficar menor que a real.",
    );
  }
  if (rbt12.gt(SIMPLES.limite)) {
    ctx.avisos.push(`A receita dos últimos 12 meses (${moeda(rbt12)}) passou do limite do Simples Nacional (${moeda(dec(SIMPLES.limite))}). Fale com o escritório.`);
  } else if (rbt12.gt(SIMPLES.sublimite)) {
    ctx.avisos.push(
      `A receita dos últimos 12 meses passou do sublimite de ${moeda(dec(SIMPLES.sublimite))}: o ICMS e o ISS passam a ser pagos fora do DAS e não estão nesta previsão.`,
    );
  }

  // Anexo dos serviços (Fator R)
  let anexoServ: Anexo = p.anexo_servicos;
  if (p.anexo_servicos === "V" && p.fator_r && receita.servicos.gt(0)) {
    const r = r12.rbt12.gt(0) ? r12.folha12.div(r12.rbt12) : new Decimal(0);
    anexoServ = r.gte(dec(SIMPLES.fatorR).div(CEM)) ? "III" : "V";
    ctx.memoria.push({
      rotulo: "Fator R (folha ÷ receita de 12 meses)",
      valor: `${pct(r, 1)} — serviços no Anexo ${anexoServ}${anexoServ === "III" ? " (28% ou mais)" : " (abaixo de 28%)"}`,
    });
    if (r12.folhaEstimada) {
      ctx.avisos.push(
        "A folha dos últimos 12 meses (Fator R) foi estimada pelo cadastro de colaboradores e pelo pró-labore. Para mais precisão, o escritório pode informar a folha de cada mês em Configuração.",
      );
    }
  }

  let das = new Decimal(0);
  const detalhes: string[] = [];
  const merc = receita.mercadorias;
  if (merc.gt(0)) {
    const anexo = p.anexo_mercadorias as Anexo;
    const a = aliquotaEfetiva(anexo, rbt12);
    const st = Decimal.min(receita.vendasSt, merc);
    const normal = merc.minus(st);
    ctx.memoria.push({ rotulo: `Alíquota efetiva — Anexo ${anexo} (${a.faixa}ª faixa)`, valor: pct(a.efetiva) });
    if (normal.gt(0)) {
      const v = normal.times(a.efetiva);
      das = das.plus(v);
      detalhes.push(`Vendas${anexo === "II" ? " de produtos" : " de mercadorias"}: ${moeda(normal)} × ${pct(a.efetiva)} = ${moeda(centavos(v))}`);
    }
    if (st.gt(0)) {
      const parteIcms = a.dados.icms ? dec(a.dados.icms).div(CEM) : new Decimal(0);
      const aliq = a.efetiva.times(new Decimal(1).minus(parteIcms));
      const v = st.times(aliq);
      das = das.plus(v);
      detalhes.push(`Vendas com ICMS já retido por substituição tributária: ${moeda(st)} × ${pct(aliq)} (sem a parte do ICMS) = ${moeda(centavos(v))}`);
    }
  }
  const serv = receita.servicos;
  if (serv.gt(0)) {
    const a = aliquotaEfetiva(anexoServ, rbt12);
    const ret = Decimal.min(receita.servicosRetido, serv);
    const normal = serv.minus(ret);
    ctx.memoria.push({ rotulo: `Alíquota efetiva — Anexo ${anexoServ} (${a.faixa}ª faixa)`, valor: pct(a.efetiva) });
    if (normal.gt(0)) {
      const v = normal.times(a.efetiva);
      das = das.plus(v);
      detalhes.push(`Serviços: ${moeda(normal)} × ${pct(a.efetiva)} = ${moeda(centavos(v))}`);
    }
    if (ret.gt(0)) {
      const parteIss = a.dados.iss ? Decimal.min(a.efetiva.times(dec(a.dados.iss).div(CEM)), dec(SIMPLES.issMaximo).div(CEM)) : new Decimal(0);
      const aliq = a.efetiva.minus(parteIss);
      const v = ret.times(aliq);
      das = das.plus(v);
      detalhes.push(`Serviços com ISS retido pelo tomador: ${moeda(ret)} × ${pct(aliq)} (sem a parte do ISS) = ${moeda(centavos(v))}`);
    }
    if (anexoServ === "IV") {
      ctx.avisos.push("Anexo IV: a contribuição patronal (INSS) não está no DAS e é paga à parte, sobre a folha (incluída abaixo quando houver folha).");
    }
  }
  if (merc.isZero() && serv.isZero()) detalhes.push("Sem receita no mês: não há DAS a pagar.");
  addLinha(ctx, { chave: "das", tributo: "DAS — Simples Nacional", guia: "DAS", grupo: "pagar", valor: das, detalhes, obrigacao: "SN_DAS" });
  ctx.avisos.push(
    "Receitas com PIS/Cofins monofásico, isenções e exportações reduzem o DAS, mas não são identificadas automaticamente: o escritório confere na apuração.",
  );
  return anexoServ;
}

/**
 * Receita bruta dos 12 meses anteriores (RBT12) pelo mesmo critério da
 * previsão: receita informada pelo escritório quando houver, senão a das
 * notas; empresa com menos de 12 meses usa a média × 12. Usada pelo auditor
 * fiscal para achar a faixa e a alíquota efetiva do Simples de cada mês.
 */
export function receitaBruta12Meses(dados: DadosPrevisao, competencia: string) {
  const comp = `${competencia.slice(0, 7)}-01`;
  const porMes = new Map(dados.meses.map((m) => [`${String(m.competencia).slice(0, 7)}-01`, m]));
  const p = (dados.parametros ?? { inicio_atividade: null, pro_labore: null }) as ParametrosCalculo;
  const ctx: Ctx = {
    dados,
    p,
    comp,
    mes: (c) => porMes.get(c),
    receita: receitaDoMes(porMes.get(comp)),
    linhas: [],
    avisos: [],
    memoria: [],
    fontes: [],
  };
  const r = receita12Meses(ctx);
  return { rbt12: centavos(r.rbt12), mesesSemDados: r.semDados, observacao: r.observacao };
}

/**
 * DAS de uma competência pelo mesmo cálculo da previsão (usado no comparativo
 * de regimes, que precisa do DAS de cada mês com a RBT12 daquele mês).
 */
export function dasSimples(dados: DadosPrevisao, competencia: string) {
  const comp = `${competencia.slice(0, 7)}-01`;
  const porMes = new Map(dados.meses.map((m) => [`${String(m.competencia).slice(0, 7)}-01`, m]));
  const ctx: Ctx = {
    dados,
    p: dados.parametros as ParametrosCalculo,
    comp,
    mes: (c) => porMes.get(c),
    receita: receitaDoMes(porMes.get(comp)),
    linhas: [],
    avisos: [],
    memoria: [],
    fontes: [],
  };
  const r12 = receita12Meses(ctx);
  const anexoServicos = calcularSimples(ctx);
  return {
    valor: ctx.linhas.find((l) => l.chave === "das")?.valor ?? new Decimal(0),
    anexoServicos,
    rbt12: centavos(r12.rbt12),
    mesesSemDados: r12.semDados,
    folhaEstimada: r12.folhaEstimada,
  };
}

// -----------------------------------------------------------------------------
// Lucro Presumido e Lucro Real
// -----------------------------------------------------------------------------
export function basesPresuncao(p: ParametrosCalculo, merc: Decimal, serv: Decimal) {
  return {
    irpj: merc.times(dec(p.presuncao_irpj_mercadorias)).plus(serv.times(dec(p.presuncao_irpj_servicos))).div(CEM),
    csll: merc.times(dec(p.presuncao_csll_mercadorias)).plus(serv.times(dec(p.presuncao_csll_servicos))).div(CEM),
  };
}

export function irpjSobre(base: Decimal, meses: number) {
  const normal = base.times(IRPJ_CSLL.irpj).div(CEM);
  const adicional = Decimal.max(0, base.minus(dec(IRPJ_CSLL.adicionalLimiteMensal).times(meses))).times(IRPJ_CSLL.adicional).div(CEM);
  return { normal, adicional, total: normal.plus(adicional) };
}

function pisCofinsCumulativo(ctx: Ctx) {
  const { receita } = ctx;
  addFonte(ctx, PIS_COFINS.fonteCumulativo);
  const base = Decimal.max(0, receita.total.minus(receita.icmsVendas));
  const det = [`Receita do mês: ${moeda(receita.total)}`];
  if (receita.icmsVendas.gt(0)) det.push(`(−) ICMS destacado nas vendas (fora da base, decisão do STF — Tema 69): ${moeda(receita.icmsVendas)}`);
  const pis = base.times(PIS_COFINS.cumulativo.pis).div(CEM);
  const cofins = base.times(PIS_COFINS.cumulativo.cofins).div(CEM);
  addLinha(ctx, {
    chave: "pis",
    tributo: "PIS",
    guia: "DARF",
    grupo: "pagar",
    valor: pis,
    detalhes: [...det, `Base ${moeda(base)} × ${pctNum(PIS_COFINS.cumulativo.pis)} (cumulativo)`],
    obrigacao: "PIS_COFINS",
  });
  addLinha(ctx, {
    chave: "cofins",
    tributo: "Cofins",
    guia: "DARF",
    grupo: "pagar",
    valor: cofins,
    detalhes: [...det, `Base ${moeda(base)} × ${pctNum(PIS_COFINS.cumulativo.cofins)} (cumulativo)`],
    obrigacao: "PIS_COFINS",
  });
}

function pisCofinsNaoCumulativo(ctx: Ctx) {
  const { receita, p } = ctx;
  addFonte(ctx, PIS_COFINS.fonteNaoCumulativo);
  const m = ctx.mes(ctx.comp);
  const base = Decimal.max(0, receita.total.minus(receita.icmsVendas));
  const credito = p.creditos_pis_cofins && m ? Decimal.max(0, dec(m.compras).minus(dec(m.icms_compras))) : new Decimal(0);
  for (const [chave, nome, aliquota] of [
    ["pis", "PIS", PIS_COFINS.naoCumulativo.pis],
    ["cofins", "Cofins", PIS_COFINS.naoCumulativo.cofins],
  ] as const) {
    const debito = base.times(aliquota).div(CEM);
    const cred = credito.times(aliquota).div(CEM);
    const saldo = debito.minus(cred);
    const det = [`Débito: base ${moeda(base)} × ${pctNum(aliquota)} = ${moeda(centavos(debito))}`];
    if (receita.icmsVendas.gt(0)) det.push(`A base já exclui o ICMS destacado nas vendas (${moeda(receita.icmsVendas)}).`);
    if (cred.gt(0)) det.push(`(−) Créditos sobre compras das notas de entrada: ${moeda(credito)} × ${pctNum(aliquota)} = ${moeda(centavos(cred))}`);
    if (saldo.lt(0)) det.push(`Créditos maiores que o débito: saldo credor de ${moeda(centavos(saldo.abs()))} para os próximos meses.`);
    addLinha(ctx, { chave, tributo: nome, guia: "DARF", grupo: "pagar", valor: Decimal.max(0, saldo), detalhes: det, obrigacao: "PIS_COFINS" });
  }
  ctx.avisos.push(
    "PIS/Cofins não cumulativos: a previsão considera créditos só sobre as compras das notas de entrada. Créditos de energia, aluguéis, fretes e depreciação entram na apuração do escritório.",
  );
}

function irpjCsllPresumido(ctx: Ctx) {
  const { p, comp } = ctx;
  addFonte(ctx, IRPJ_CSLL.fonte);
  const mesNum = Number(comp.slice(5, 7));
  const fimTrimestre = mesNum % 3 === 0;
  const inicioTrimestre = somarMeses(comp, -((mesNum - 1) % 3));
  const fimTrim = somarMeses(inicioTrimestre, 2);
  if (fimTrimestre) {
    let merc = new Decimal(0);
    let serv = new Decimal(0);
    const semDados: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = somarMeses(inicioTrimestre, i);
      const r = c === comp ? ctx.receita : receitaDoMes(ctx.mes(c));
      if (r.fonte === "sem_dados") semDados.push(c);
      merc = merc.plus(r.mercadorias);
      serv = serv.plus(r.servicos);
    }
    if (semDados.length) ctx.avisos.push(`IRPJ/CSLL do trimestre: sem receita registrada em ${semDados.map((m) => formatarCompetencia(m)).join(", ")}.`);
    const total = merc.plus(serv);
    let fatorIrpj = new Decimal(1);
    let fatorCsll = new Decimal(1);
    const det: string[] = [`Receita do trimestre (${formatarCompetencia(inicioTrimestre)} a ${formatarCompetencia(comp)}): ${moeda(total)}`];
    if (p.acrescimo_lc224 && comp.slice(0, 7) >= LC224.inicioIrpj && total.gt(LC224.limiteTrimestral)) {
      const excesso = total.minus(LC224.limiteTrimestral);
      const fracao = excesso.div(total).times(LC224.acrescimo).div(CEM);
      fatorIrpj = fatorIrpj.plus(fracao);
      if (inicioTrimestre.slice(0, 7) >= LC224.inicioCsll) fatorCsll = fatorCsll.plus(fracao);
      addFonte(ctx, LC224.fonte);
      det.push(`LC 224/2025: presunção 10% maior sobre ${moeda(excesso)} (receita acima de ${moeda(dec(LC224.limiteTrimestral))} no trimestre).`);
    }
    const b = basesPresuncao(p, merc, serv);
    const baseIrpj = b.irpj.times(fatorIrpj);
    const baseCsll = b.csll.times(fatorCsll);
    const irpj = irpjSobre(baseIrpj, 3);
    const csll = baseCsll.times(IRPJ_CSLL.csll).div(CEM);
    const quotas = "Pode ser pago em quota única ou em até 3 quotas mensais (mínimo de R$ 1.000,00 cada; as seguintes com juros Selic).";
    addLinha(ctx, {
      chave: "irpj",
      tributo: "IRPJ do trimestre",
      guia: "DARF",
      grupo: "pagar",
      valor: irpj.total,
      detalhes: [
        ...det,
        `Base presumida: ${moeda(centavos(baseIrpj))} (${pctNum(p.presuncao_irpj_mercadorias)} das vendas e ${pctNum(p.presuncao_irpj_servicos)} dos serviços)`,
        `IRPJ ${pctNum(IRPJ_CSLL.irpj)}: ${moeda(centavos(irpj.normal))}` +
          (irpj.adicional.gt(0) ? ` + adicional de 10% sobre o que passa de R$ 60.000,00: ${moeda(centavos(irpj.adicional))}` : ""),
        quotas,
      ],
      obrigacao: "IRPJ_CSLL_TRIM",
    });
    addLinha(ctx, {
      chave: "csll",
      tributo: "CSLL do trimestre",
      guia: "DARF",
      grupo: "pagar",
      valor: csll,
      detalhes: [
        `Base presumida: ${moeda(centavos(baseCsll))} (${pctNum(p.presuncao_csll_mercadorias)} das vendas e ${pctNum(p.presuncao_csll_servicos)} dos serviços) × ${pctNum(IRPJ_CSLL.csll)}`,
        quotas,
      ],
      obrigacao: "IRPJ_CSLL_TRIM",
    });
    ctx.avisos.push("IRPJ/CSLL: retenções feitas pelos clientes (IR 1,5% e CSRF em serviços) podem ser descontadas e não estão nesta previsão.");
  } else {
    const b = basesPresuncao(p, ctx.receita.mercadorias, ctx.receita.servicos);
    const irpj = irpjSobre(b.irpj, 1);
    const csll = b.csll.times(IRPJ_CSLL.csll).div(CEM);
    const quando = `Reserva deste mês: o IRPJ e a CSLL são pagos depois do fim do trimestre (competência ${formatarCompetencia(fimTrim)}).`;
    addLinha(ctx, {
      chave: "irpj",
      tributo: "IRPJ (reserva do trimestre)",
      guia: "DARF",
      grupo: "provisao",
      valor: irpj.total,
      detalhes: [quando, `Base presumida do mês: ${moeda(centavos(b.irpj))} × ${pctNum(IRPJ_CSLL.irpj)}${irpj.adicional.gt(0) ? " + adicional de 10%" : ""}`],
    });
    addLinha(ctx, {
      chave: "csll",
      tributo: "CSLL (reserva do trimestre)",
      guia: "DARF",
      grupo: "provisao",
      valor: csll,
      detalhes: [quando, `Base presumida do mês: ${moeda(centavos(b.csll))} × ${pctNum(IRPJ_CSLL.csll)}`],
    });
  }
}

function irpjCsllReal(ctx: Ctx) {
  const { p, dados } = ctx;
  addFonte(ctx, IRPJ_CSLL.fonte);
  const apuracao = dados.empresa.lucro_real_apuracao;
  if (apuracao === "anual") {
    const b = basesPresuncao(p, ctx.receita.mercadorias, ctx.receita.servicos);
    const irpj = irpjSobre(b.irpj, 1);
    const csll = b.csll.times(IRPJ_CSLL.csll).div(CEM);
    const obs = "Estimativa mensal pela receita; pode ser reduzida ou suspensa por balancete (o escritório ajusta).";
    addLinha(ctx, {
      chave: "irpj",
      tributo: "IRPJ — estimativa mensal",
      guia: "DARF",
      grupo: "pagar",
      valor: irpj.total,
      detalhes: [
        `Base estimada: ${moeda(centavos(b.irpj))} × ${pctNum(IRPJ_CSLL.irpj)}` + (irpj.adicional.gt(0) ? ` + adicional de 10% sobre o que passa de R$ 20.000,00` : ""),
        obs,
      ],
      obrigacao: "IRPJ_CSLL_EST",
    });
    addLinha(ctx, {
      chave: "csll",
      tributo: "CSLL — estimativa mensal",
      guia: "DARF",
      grupo: "pagar",
      valor: csll,
      detalhes: [`Base estimada: ${moeda(centavos(b.csll))} × ${pctNum(IRPJ_CSLL.csll)}`, obs],
      obrigacao: "IRPJ_CSLL_EST",
    });
  } else if (apuracao === "trimestral") {
    ctx.avisos.push("Lucro Real trimestral: o IRPJ e a CSLL são apurados sobre o lucro do trimestre (balancete). O escritório lança o valor nos ajustes quando apurar.");
  } else {
    ctx.avisos.push("Lucro Real: falta informar se a apuração é trimestral ou anual (Obrigações e prazos → Empresas → regime).");
  }
}

function tributosLocais(ctx: Ctx) {
  const { p, dados, receita } = ctx;
  const m = ctx.mes(ctx.comp);
  // ISS próprio (fora do Simples)
  if (receita.servicos.gt(0) || dados.empresa.contribuinte_iss) {
    const aliquota = p.aliquota_iss == null ? null : dec(p.aliquota_iss);
    let iss = new Decimal(0);
    const det: string[] = [];
    let falta = false;
    if (receita.fonte === "notas" && m) {
      const destacado = dec(m.iss_destacado);
      const semIss = dec(m.servicos_sem_iss);
      if (destacado.gt(0)) det.push(`ISS informado nas notas de serviço: ${moeda(destacado)}`);
      iss = iss.plus(destacado);
      if (semIss.gt(0)) {
        if (aliquota) {
          iss = iss.plus(semIss.times(aliquota).div(CEM));
          det.push(`Notas sem o valor do ISS: ${moeda(semIss)} × ${pctNum(p.aliquota_iss)}`);
        } else falta = true;
      }
    } else if (receita.servicos.gt(0)) {
      const base = receita.servicos.minus(receita.servicosRetido);
      if (aliquota) {
        iss = base.times(aliquota).div(CEM);
        det.push(`Serviços: ${moeda(base)} × ${pctNum(p.aliquota_iss)}`);
      } else falta = true;
    }
    if (falta) ctx.avisos.push("Defina a alíquota do ISS do município em Cálculos → Configuração para incluir o ISS na previsão.");
    if (m && dec(m.iss_retido).gt(0)) det.push(`ISS retido pelos tomadores: ${moeda(dec(m.iss_retido))} (descontado pelo cliente; não entra na guia).`);
    if (iss.gt(0)) addLinha(ctx, { chave: "iss", tributo: "ISS", guia: "Guia municipal", grupo: "pagar", valor: iss, detalhes: det, obrigacao: "ISS" });
  }
  // ICMS próprio (débitos − créditos das notas)
  if (dados.empresa.contribuinte_icms && p.calcular_icms && m) {
    const debito = dec(m.icms_debito);
    const credito = dec(m.icms_credito);
    const saldo = debito.minus(credito);
    if (saldo.gt(0)) {
      addLinha(ctx, {
        chave: "icms",
        tributo: "ICMS (apuração própria)",
        guia: "Guia estadual",
        grupo: "pagar",
        valor: saldo,
        detalhes: [`Débitos (ICMS das notas de saída): ${moeda(debito)}`, `(−) Créditos (ICMS das notas de entrada): ${moeda(credito)}`],
        obrigacao: "ICMS",
      });
    } else if (debito.gt(0) || credito.gt(0)) {
      ctx.avisos.push(`ICMS: créditos maiores que os débitos no mês (saldo credor de ${moeda(centavos(saldo.abs()))}); não há ICMS próprio a pagar.`);
    }
    ctx.avisos.push("ICMS: saldo credor de meses anteriores, substituição tributária, diferencial de alíquota (DIFAL) e antecipações não entram no cálculo automático; o escritório pode lançá-los como ajuste.");
  }
  // IPI (indústria)
  if (p.calcular_ipi && m) {
    const saldo = dec(m.ipi_debito).minus(dec(m.ipi_credito));
    if (saldo.gt(0)) {
      addLinha(ctx, {
        chave: "ipi",
        tributo: "IPI",
        guia: "DARF",
        grupo: "pagar",
        valor: saldo,
        detalhes: [`Débitos (notas de saída): ${moeda(dec(m.ipi_debito))}`, `(−) Créditos (notas de entrada): ${moeda(dec(m.ipi_credito))}`],
      });
    }
  }
}

// -----------------------------------------------------------------------------
// Folha (INSS, IRRF e FGTS)
// -----------------------------------------------------------------------------
type TipoFolha = "simples" | "simples_iv" | "mei" | "geral";

function calcularFolha(ctx: Ctx, tipo: TipoFolha) {
  const { comp, p, dados } = ctx;
  const folha = folhaDoMes(dados, comp);
  const pls = tipo === "mei" ? [] : proLabores(p);
  const totalPl = pls.reduce((s, v) => s.plus(v), new Decimal(0));
  if (dados.empresa.tem_empregados && folha.remuneracoes.length === 0) {
    ctx.avisos.push("A empresa tem empregados, mas nenhum colaborador está cadastrado para este mês: cadastre em Cálculos → Colaboradores para incluir a folha.");
  }
  if (dados.empresa.tem_pro_labore && totalPl.isZero() && tipo !== "mei") {
    ctx.avisos.push("A empresa tem pró-labore, mas o valor não foi informado em Cálculos → Configuração.");
  }
  if (folha.remuneracoes.length === 0 && totalPl.isZero()) return;

  const inss = vigente(INSS_EMPREGADO, comp);
  const irrf = vigente(IRRF, comp);
  for (const a of [inss.aviso, irrf.aviso]) if (a && !ctx.avisos.includes(a)) ctx.avisos.push(a);
  addFonte(ctx, inss.fonte);
  addFonte(ctx, irrf.fonte);
  addFonte(ctx, FOLHA.fonteCpp);
  addFonte(ctx, FOLHA.fonteFgts);

  const mes = Number(comp.slice(5, 7));
  const ano = Number(comp.slice(0, 4));
  let inssEmp = new Decimal(0);
  let irrfEmp = new Decimal(0);
  let fgtsBase = folha.total;
  let base13 = new Decimal(0);
  let inss13 = new Decimal(0);
  let irrf13Total = new Decimal(0);
  for (const r of folha.remuneracoes) {
    const i = inssEmpregado(r.valor, comp);
    inssEmp = inssEmp.plus(i);
    irrfEmp = irrfEmp.plus(irrfMensal(r.valor, i, r.dependentes, comp));
  }
  // 13º salário: 1ª parcela (FGTS em novembro) e 2ª parcela (dezembro: INSS, IRRF e FGTS do restante)
  if (mes === 11 || mes === 12) {
    for (const r of folha.remuneracoes) {
      const c = r.colaborador;
      const mensal = dec(c.salario).plus(dec(c.adicionais));
      const primeira = centavos(mensal.times(avos13NoAno(ano, 11, c.admissao, c.desligamento)).div(12).div(2));
      if (mes === 11) fgtsBase = fgtsBase.plus(primeira);
      else {
        const total13 = centavos(mensal.times(avos13NoAno(ano, 12, c.admissao, c.desligamento)).div(12));
        const i13 = inssEmpregado(total13, comp);
        base13 = base13.plus(total13);
        inss13 = inss13.plus(i13);
        irrf13Total = irrf13Total.plus(irrf13(total13, i13, r.dependentes, comp));
        fgtsBase = fgtsBase.plus(Decimal.max(0, total13.minus(primeira)));
      }
    }
  }

  const teto = dec(inss.dados.teto);
  let inssPl = new Decimal(0);
  let irrfPl = new Decimal(0);
  for (const v of pls) {
    const i = centavos(Decimal.min(v, teto).times(FOLHA.proLaboreInss).div(CEM));
    inssPl = inssPl.plus(i);
    irrfPl = irrfPl.plus(irrfMensal(v, i, 0, comp));
  }

  const baseSalarios = folha.total.plus(base13);
  let patronal = new Decimal(0);
  const detPatronal: string[] = [];
  if (tipo === "mei") {
    patronal = baseSalarios.times(MEI.cppEmpregado).div(CEM);
    detPatronal.push(`Contribuição patronal do MEI (${MEI.cppEmpregado}% da folha): ${moeda(centavos(patronal))}`);
  } else if (tipo === "simples_iv" || tipo === "geral") {
    const cpp = baseSalarios.plus(totalPl).times(FOLHA.cpp).div(CEM);
    const ratFap = dec(p.rat).times(dec(p.fap));
    const rat = baseSalarios.times(ratFap).div(CEM);
    patronal = cpp.plus(rat);
    detPatronal.push(`Contribuição patronal (${FOLHA.cpp}% da folha${totalPl.gt(0) ? " e do pró-labore" : ""}): ${moeda(centavos(cpp))}`);
    detPatronal.push(`RAT/FAP (${pctNum(p.rat, 1)} × ${dec(p.fap).toFixed(4).replace(".", ",")}): ${moeda(centavos(rat))}`);
    if (tipo === "geral") {
      const terceiros = baseSalarios.times(dec(p.terceiros)).div(CEM);
      patronal = patronal.plus(terceiros);
      detPatronal.push(`Outras entidades (terceiros, ${pctNum(p.terceiros)}): ${moeda(centavos(terceiros))}`);
    }
  } else {
    detPatronal.push("A contribuição patronal já está dentro do DAS (Simples Nacional).");
  }

  const totalInss = patronal.plus(inssEmp).plus(inssPl).plus(inss13);
  const totalIrrf = irrfEmp.plus(irrfPl).plus(irrf13Total);
  const det: string[] = [];
  if (folha.remuneracoes.length) det.push(`Folha do mês: ${moeda(folha.total)} (${folha.remuneracoes.length} ${folha.remuneracoes.length === 1 ? "colaborador" : "colaboradores"})`);
  if (totalPl.gt(0)) det.push(`Pró-labore: ${moeda(totalPl)} (${pls.length} ${pls.length === 1 ? "sócio" : "sócios"})`);
  if (base13.gt(0)) det.push(`13º salário (2ª parcela, dezembro): ${moeda(base13)}`);
  det.push(...detPatronal);
  if (inssEmp.gt(0)) det.push(`INSS descontado dos empregados: ${moeda(inssEmp)}`);
  if (inss13.gt(0)) det.push(`INSS descontado do 13º: ${moeda(inss13)}`);
  if (inssPl.gt(0)) det.push(`INSS descontado do pró-labore (${FOLHA.proLaboreInss}%): ${moeda(inssPl)}`);
  if (totalIrrf.gt(0)) det.push(`IRRF descontado de salários${totalPl.gt(0) ? " e pró-labore" : ""}${irrf13Total.gt(0) ? " (inclui o do 13º)" : ""}: ${moeda(centavos(totalIrrf))}`);
  det.push("Os valores descontados dos empregados e dos sócios saem do pagamento deles, mas a empresa é quem recolhe.");
  addLinha(ctx, {
    chave: "folha_inss_irrf",
    tributo: "INSS e IRRF da folha",
    guia: "DARF (DCTFWeb)",
    grupo: "pagar",
    valor: totalInss.plus(totalIrrf),
    detalhes: det,
    obrigacao: "INSS_DARF",
  });
  if (fgtsBase.gt(0)) {
    const detF = [`${FOLHA.fgts}% sobre ${moeda(centavos(fgtsBase))}`];
    if (mes === 11) detF.push("Inclui o FGTS da 1ª parcela do 13º salário.");
    if (mes === 12) detF.push("Inclui o FGTS da 2ª parcela do 13º salário.");
    addLinha(ctx, {
      chave: "fgts",
      tributo: "FGTS",
      guia: "Guia do FGTS Digital",
      grupo: "pagar",
      valor: fgtsBase.times(FOLHA.fgts).div(CEM),
      detalhes: detF,
      obrigacao: "FGTS",
    });
  }
  ctx.memoria.push({ rotulo: "Folha considerada", valor: moeda(folha.total.plus(totalPl)) });
  ctx.avisos.push("Folha: férias, horas extras, faltas e outros eventos do mês não são considerados; o valor exato sai da folha processada pelo escritório.");
}

// -----------------------------------------------------------------------------
// Previsão
// -----------------------------------------------------------------------------
const REGIMES_SUPORTADOS = ["mei", "simples_nacional", "lucro_presumido", "lucro_real"];

export function calcularPrevisao(dados: DadosPrevisao): Previsao {
  const comp = `${dados.competencia.slice(0, 7)}-01`;
  const regime = dados.empresa.regime;
  const porMes = new Map(dados.meses.map((m) => [`${String(m.competencia).slice(0, 7)}-01`, m]));
  const mes = (c: string) => porMes.get(c);
  const receita = receitaDoMes(mes(comp));
  const faltantes = dados.checklist?.faltantes ?? [];
  const base: Previsao = {
    competencia: comp,
    mesPagamento: somarMeses(comp, 1),
    regime,
    regimeRotulo: regime ? (REGIMES[regime] ?? regime) : "Regime não informado",
    situacao: "ok",
    mensagem: null,
    receita: { mercadorias: receita.mercadorias, servicos: receita.servicos, total: receita.total, fonte: receita.fonte, notas: receita.notas },
    linhas: [],
    totalPagar: new Decimal(0),
    totalProvisao: new Decimal(0),
    memoria: [],
    avisos: [],
    fontes: [],
    checklist: { completo: faltantes.length === 0, semChecklist: !dados.checklist || dados.checklist.itens === 0, faltantes },
    guiasPublicadas: dados.guias_publicadas ?? 0,
  };

  if (comp.slice(0, 7) < PRIMEIRA_COMPETENCIA) {
    return { ...base, situacao: "competencia_nao_suportada", mensagem: `As previsões estão disponíveis a partir de ${formatarCompetencia(`${PRIMEIRA_COMPETENCIA}-01`, true)}.` };
  }
  if (!regime || !REGIMES_SUPORTADOS.includes(regime)) {
    base.situacao = "regime_nao_suportado";
    base.mensagem = `A previsão automática não está disponível para o regime ${base.regimeRotulo}. O escritório pode lançar os valores do mês manualmente.`;
  } else if (!dados.parametros) {
    return { ...base, situacao: "sem_parametros", mensagem: "O escritório ainda não configurou os cálculos desta empresa." };
  }

  const ctx: Ctx = {
    dados,
    p: dados.parametros as ParametrosCalculo,
    comp,
    mes,
    receita,
    linhas: [],
    avisos: [],
    memoria: [],
    fontes: [],
  };

  if (base.situacao === "ok") {
    const rotuloFonte =
      receita.fonte === "informada"
        ? "informada pelo escritório"
        : receita.fonte === "notas"
          ? `${receita.notas} ${receita.notas === 1 ? "nota fiscal de saída" : "notas fiscais de saída"}`
          : "sem notas nem receita informada";
    ctx.memoria.push({ rotulo: `Receita de ${formatarCompetencia(comp, true)} (${rotuloFonte})`, valor: moeda(receita.total) });
    if (receita.mercadorias.gt(0) && receita.servicos.gt(0)) {
      ctx.memoria.push({ rotulo: "Vendas / serviços", valor: `${moeda(receita.mercadorias)} / ${moeda(receita.servicos)}` });
    }
    const obs = mes(comp)?.informado?.observacao;
    if (receita.fonte === "informada" && obs) ctx.memoria.push({ rotulo: "Observação do escritório", valor: obs });
    if (receita.fonte === "sem_dados" && regime !== "mei") {
      ctx.avisos.push(`Nenhuma nota fiscal de saída de ${formatarCompetencia(comp, true)} foi enviada e nenhuma receita foi informada: a previsão considera faturamento zero.`);
    }

    if (regime === "mei") {
      calcularMei(ctx);
      calcularFolha(ctx, "mei");
    } else if (regime === "simples_nacional") {
      const anexoServ = calcularSimples(ctx);
      const temIv = anexoServ === "IV" && receita.servicos.gt(0);
      if (temIv && receita.mercadorias.gt(0)) {
        ctx.avisos.push("Empresa com atividades do Anexo IV e de outros anexos: a contribuição patronal pode ser proporcional; o escritório confere na apuração.");
      }
      calcularFolha(ctx, temIv ? "simples_iv" : "simples");
    } else {
      if (regime === "lucro_presumido") {
        pisCofinsCumulativo(ctx);
        irpjCsllPresumido(ctx);
      } else {
        pisCofinsNaoCumulativo(ctx);
        irpjCsllReal(ctx);
      }
      tributosLocais(ctx);
      calcularFolha(ctx, "geral");
      if (comp.startsWith("2026")) {
        addFonte(ctx, CBS_IBS_2026);
        ctx.avisos.push("CBS (0,9%) e IBS (0,1%) destacados nas notas em 2026 são de teste: não há pagamento para quem cumpre as obrigações acessórias.");
      }
    }
  }

  // Valores lançados pelo escritório
  for (const a of dados.ajustes) {
    addLinha(ctx, {
      chave: `ajuste:${a.id}`,
      tributo: a.descricao,
      guia: "Lançado pelo escritório",
      grupo: "pagar",
      valor: dec(a.valor),
      detalhes: a.observacao ? [a.observacao] : [],
    });
  }

  // Vencimento e valor da guia (módulo de obrigações)
  for (const l of ctx.linhas) {
    if (!l.obrigacao) continue;
    const v = dados.vencimentos.find((x) => x.codigo === l.obrigacao);
    if (v) {
      l.vencimento = v.vencimento;
      l.valorGuia = v.valor_guia != null ? dec(v.valor_guia) : null;
    }
  }

  const totalPagar = ctx.linhas.filter((l) => l.grupo === "pagar").reduce((s, l) => s.plus(l.valor), new Decimal(0));
  const totalProvisao = ctx.linhas.filter((l) => l.grupo === "provisao").reduce((s, l) => s.plus(l.valor), new Decimal(0));
  return {
    ...base,
    linhas: ctx.linhas,
    totalPagar: centavos(totalPagar),
    totalProvisao: centavos(totalProvisao),
    memoria: ctx.memoria,
    avisos: [...new Set(ctx.avisos)],
    fontes: ctx.fontes,
  };
}

/** Texto curto do vencimento de uma linha. */
export function textoVencimento(l: LinhaPrevisao): string {
  return l.vencimento ? `vence em ${formatarData(l.vencimento)}` : "vencimento conforme a guia";
}
