import Decimal from "decimal.js";
import { ANEXOS_SIMPLES, SIMPLES } from "@/lib/calculos/tabelas";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { prazoRestituicao, type AchadoCalculado, type Confianca, type Referencia } from "./regras";
import { FONTES_SERVICOS } from "./tabelas";

/**
 * Regras do auditor para as notas de serviço (NFS-e) emitidas pela empresa.
 * Cálculo fixo, com a base legal de cada achado — sem inteligência
 * artificial. O auditor não vê o PGDAS-D nem a DCTFWeb: os achados são
 * indícios para o contador conferir.
 */

type Num = number | string | null | undefined;

/** NFS-e do período (public.auditor_servicos). */
export interface NotaServico {
  id: string;
  documento_id: string | null;
  numero: string | null;
  modelo: string;
  data: string | null;
  competencia: string;
  operacao: "entrada" | "saida";
  valor: Num;
  liquido: Num;
  tributos: Record<string, string> | null;
  contraparte_documento: string | null;
  contraparte: string | null;
}

export type AnexoServicos = "III" | "IV" | "V";

export interface MesSimplesServicos {
  rbt12: Decimal;
  anexo: AnexoServicos;
  /** Anexo definido nos Cálculos da empresa (sem isso, presume-se o Anexo III). */
  anexoInformado: boolean;
  /** Anexo III/V decidido pelo Fator R com a folha estimada (sem a folha informada mês a mês). */
  fatorREstimado: boolean;
  mesesSemDados: string[];
  observacao: string | null;
}

export interface EntradaServicos {
  inicio: string;
  fim: string;
  regimeDoMes: (competencia: string) => string | null;
  simples: (competencia: string) => MesSimplesServicos | null;
  /** Primeiro mês de atividade (AAAA-MM-01), se informado. */
  inicioAtividade: string | null;
  notas: NotaServico[];
}

const num = (v: Num) => dec(v ?? 0);
const moeda = (v: Decimal) => formatarMoeda(v);
const pct = (fracao: Decimal, casas = 2) => `${fracao.times(100).toFixed(casas).replace(".", ",")}%`;
const pctTexto = (p: Decimal | string, casas = 2) => `${dec(p).toFixed(casas).replace(".", ",")}%`;
const mes = (c: string) => formatarCompetencia(c);
const mesLongo = (c: string) => formatarCompetencia(c, true);
const REGIME_NORMAL = new Set(["lucro_presumido", "lucro_real", "lucro_arbitrado"]);
const NOME_REGIME: Record<string, string> = { lucro_presumido: "Lucro Presumido", lucro_real: "Lucro Real", lucro_arbitrado: "Lucro Arbitrado" };
const TOLERANCIA_ALIQUOTA = new Decimal("0.01");

const t = (n: NotaServico) => n.tributos ?? {};
/** ISS retido pelo tomador ou pelo intermediário. */
export const issRetido = (n: NotaServico) => ["2", "3"].includes(t(n).tp_ret_iss ?? "") || t(n).iss_retido === "sim";
/** ISS fora do DAS (apuração do ISS pela NFS-e, por exemplo, acima do sublimite). */
const issForaDoDas = (n: NotaServico) => ["2", "3"].includes(t(n).reg_ap_trib_sn ?? "");
/** Imunidade, exportação ou não incidência do ISS. */
const semIss = (n: NotaServico) => ["2", "3", "4"].includes(t(n).trib_iss ?? "");
const baseIss = (n: NotaServico) => (num(t(n).base_iss).gt(0) ? num(t(n).base_iss) : num(n.valor));

/**
 * Retenções federais da nota. Na NFS-e nacional, desde a NT 007/2026 o campo
 * vRetCSLL traz a soma do PIS, da Cofins e da CSLL retidos; antes (tipo de
 * retenção 1), PIS e Cofins retidos vinham em vPis/vCofins. Quando a nota traz
 * o total de retenções (vTotalRet), ele prevalece.
 */
export function retencoesFederais(n: NotaServico) {
  const x = t(n);
  const irrf = num(x.ret_irrf);
  const cp = num(x.ret_cp);
  let csrf: Decimal;
  if (x.ret_pis || x.ret_cofins) {
    // ABRASF: PIS, Cofins e CSLL retidos em campos próprios
    csrf = num(x.ret_pis).plus(num(x.ret_cofins)).plus(num(x.ret_csll));
  } else if (x.total_ret) {
    const issNaNota = issRetido(n) ? num(x.iss) : new Decimal(0);
    csrf = Decimal.max(0, num(x.total_ret).minus(issNaNota).minus(irrf).minus(cp));
  } else {
    const csll = num(x.ret_csll);
    const pisCofins = num(x.pis).plus(num(x.cofins));
    csrf = x.tp_ret_pis_cofins === "1" && pisCofins.gt(csll) ? csll.plus(pisCofins) : csll;
  }
  return { irrf, csrf, cp };
}

/** Alíquota efetiva do Simples e a parte do ISS (com o teto de 5%) para os anexos de serviço. */
export function issEfetivoSimples(anexo: AnexoServicos, rbt12: Decimal) {
  const tabela = ANEXOS_SIMPLES[anexo];
  if (rbt12.gt(tabela[tabela.length - 1].ate)) return null;
  const faixa = Math.max(0, tabela.findIndex((f) => rbt12.lte(f.ate)));
  const nominal = dec(tabela[faixa].aliquota).div(100);
  const efetiva = rbt12.lte(0) ? nominal : Decimal.max(0, rbt12.times(nominal).minus(dec(tabela[faixa].deduzir)).div(rbt12));
  const parte = tabela[faixa].iss;
  // 6ª faixa: o ISS é pago fora do DAS
  if (!parte) return { faixa, nominal, efetiva, parte: null, iss: null };
  const iss = Decimal.min(efetiva.times(dec(parte)).div(100), dec(SIMPLES.issMaximo).div(100));
  return { faixa, nominal, efetiva, parte: dec(parte), iss };
}

function memoriaSimples(s: MesSimplesServicos, ef: NonNullable<ReturnType<typeof issEfetivoSimples>>, rotuloMes = "do mês") {
  const linhas = [
    { rotulo: `Receita bruta dos 12 meses anteriores (RBT12) ${rotuloMes}`, valor: moeda(s.rbt12) },
    {
      rotulo: "Anexo e faixa do Simples (serviços)",
      valor: `Anexo ${s.anexo}${s.anexoInformado ? (s.fatorREstimado ? " (Fator R com folha estimada)" : "") : " (presumido)"}, ${ef.faixa + 1}ª faixa`,
    },
    { rotulo: `Alíquota efetiva ${rotuloMes}`, valor: pct(ef.efetiva) },
  ];
  if (ef.parte && ef.iss) {
    const semTeto = ef.efetiva.times(ef.parte).div(100);
    linhas.push({
      rotulo: "Parte do ISS na alíquota efetiva",
      valor: `${pct(ef.efetiva)} × ${pctTexto(ef.parte)} = ${pct(ef.iss, 4)}${semTeto.gt(ef.iss) ? " (teto de 5%)" : ""}`,
    });
  }
  if (s.observacao) linhas.push({ rotulo: "Observação sobre a RBT12", valor: s.observacao });
  if (s.mesesSemDados.length) linhas.push({ rotulo: "Meses sem receita no portal", valor: s.mesesSemDados.map((m) => mes(m)).join(", ") });
  return linhas;
}

function confiancaSimples(s: MesSimplesServicos): Confianca {
  return s.anexoInformado && !s.fatorREstimado && !s.mesesSemDados.length ? "alta" : "media";
}

function referencias(notas: { n: NotaServico; valor: Decimal; motivo: string }[], limite = 15): Referencia[] {
  return [...notas]
    .sort((a, b) => b.valor.comparedTo(a.valor))
    .slice(0, limite)
    .map(({ n, valor, motivo }) => ({
      nota_id: n.id,
      documento_id: n.documento_id,
      numero: n.numero,
      modelo: n.modelo,
      data: n.data,
      item: 0,
      descricao: n.contraparte ?? (n.contraparte_documento ? `Tomador ${n.contraparte_documento}` : null),
      valor: valor.toFixed(2),
      motivo,
    }));
}

const soma = (lista: NotaServico[], f: (n: NotaServico) => Decimal) => lista.reduce((acc, n) => acc.plus(f(n)), new Decimal(0));
const notasTexto = (k: number) => `${k} ${k === 1 ? "nota" : "notas"}`;

export function auditarServicos(e: EntradaServicos): AchadoCalculado[] {
  const porMes = new Map<string, NotaServico[]>();
  for (const n of e.notas) {
    const c = `${String(n.competencia).slice(0, 7)}-01`;
    porMes.set(c, [...(porMes.get(c) ?? []), { ...n, competencia: c }]);
  }
  const achados: AchadoCalculado[] = [];
  for (let c = e.inicio; c <= e.fim; c = somarMeses(c, 1)) {
    const saidas = (porMes.get(c) ?? []).filter((n) => n.operacao === "saida");
    if (!saidas.length) continue;
    const regime = e.regimeDoMes(c);
    if (regime === "simples_nacional") {
      const s = e.simples(c);
      achados.push(...issRetidoNoDas(c, saidas, s));
      const primeiroMes = Boolean(e.inicioAtividade && c <= e.inicioAtividade);
      if (!primeiroMes) achados.push(...aliquotaIssRetido(c, saidas, e.simples(somarMeses(c, -1))));
      achados.push(...inssRetidoSimples(c, saidas, s, regime));
    }
    if (regime === "simples_nacional" || regime === "mei") {
      achados.push(...federaisRetidosSimples(c, saidas, regime));
      if (regime === "mei") achados.push(...inssRetidoSimples(c, saidas, null, regime));
    }
    achados.push(...regimeDivergente(c, saidas, regime));
  }
  return achados;
}

// ISS retido cobrado de novo no DAS --------------------------------------------
function issRetidoNoDas(c: string, saidas: NotaServico[], s: MesSimplesServicos | null): AchadoCalculado[] {
  const marcadas = saidas.filter((n) => issRetido(n) && !issForaDoDas(n) && !semIss(n));
  if (!marcadas.length || !s) return [];
  const ef = issEfetivoSimples(s.anexo, s.rbt12);
  if (!ef?.iss) return [];
  const receita = centavos(soma(marcadas, (n) => num(n.valor)));
  const retido = centavos(soma(marcadas, (n) => num(t(n).iss)));
  const valor = centavos(receita.times(ef.iss));
  if (receita.lte(0) || valor.lt("0.01")) return [];
  const prazo = prazoRestituicao(c);
  return [
    {
      regra: "iss_retido_simples",
      chave: `iss_retido_simples:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca: confiancaSimples(s),
      titulo: `ISS retido possivelmente pago de novo no DAS — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, ${moeda(receita)} em serviços tiveram o ISS retido pelo tomador (${notasTexto(marcadas.length)}` +
        `${retido.gt(0) ? `, ${moeda(retido)} de ISS retido` : ""}). Sobre essa receita não há ISS a pagar no DAS: ela precisa ser ` +
        `informada no PGDAS-D como receita com retenção de ISS. Se não foi, o DAS cobrou o ISS de novo: cerca de ${moeda(valor)}. ` +
        `Confira a apuração do mês; se for o caso, retifique o PGDAS-D e peça a restituição até ${formatarData(prazo)}.`,
      valor_base: receita.toFixed(2),
      valor_estimado: valor.toFixed(2),
      memoria: [
        { rotulo: "Serviços com ISS retido no mês", valor: `${moeda(receita)} (${notasTexto(marcadas.length)})` },
        ...(retido.gt(0) ? [{ rotulo: "ISS retido nas notas (já pago pelo tomador)", valor: moeda(retido) }] : []),
        ...memoriaSimples(s, ef),
        { rotulo: "ISS cobrado de novo no DAS, se a receita não foi separada", valor: `${moeda(receita)} × ${pct(ef.iss, 4)} = ${moeda(valor)}` },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(marcadas.map((n) => ({ n, valor: num(n.valor), motivo: `ISS retido${num(t(n).iss).gt(0) ? ` de ${moeda(num(t(n).iss))}` : ""}` }))),
      fontes: [FONTES_SERVICOS.issRetidoSimples, FONTES_SERVICOS.segregacaoIss, FONTES_SERVICOS.anexosServicos, FONTES_SERVICOS.restituicao],
    },
  ];
}

// Alíquota do ISS retido diferente da efetiva do Simples -----------------------
function aliquotaIssRetido(c: string, saidas: NotaServico[], sAnterior: MesSimplesServicos | null): AchadoCalculado[] {
  if (!sAnterior) return [];
  const ef = issEfetivoSimples(sAnterior.anexo, sAnterior.rbt12);
  if (!ef?.iss) return [];
  const devida = ef.iss.times(100);
  const comAliquota = saidas.filter((n) => issRetido(n) && !issForaDoDas(n) && !semIss(n) && num(t(n).aliq_iss).gt(0));
  const acima: { n: NotaServico; valor: Decimal; motivo: string }[] = [];
  const abaixo: { n: NotaServico; valor: Decimal; motivo: string }[] = [];
  for (const n of comAliquota) {
    const aliq = num(t(n).aliq_iss);
    const dif = aliq.minus(devida);
    if (dif.abs().lte(TOLERANCIA_ALIQUOTA)) continue;
    const valor = centavos(baseIss(n).times(dif.abs()).div(100));
    if (valor.lt("0.01")) continue;
    (dif.gt(0) ? acima : abaixo).push({ n, valor, motivo: `retido a ${pctTexto(aliq)} (devida ${pctTexto(devida)})` });
  }
  const achados: AchadoCalculado[] = [];
  const memoriaBase = memoriaSimples(sAnterior, ef, `de ${mes(somarMeses(c, -1))}`);
  const confianca = confiancaSimples(sAnterior);
  if (acima.length) {
    const total = centavos(acima.reduce((a, x) => a.plus(x.valor), new Decimal(0)));
    const base = centavos(acima.reduce((a, x) => a.plus(baseIss(x.n)), new Decimal(0)));
    const prazo = prazoRestituicao(c);
    achados.push({
      regra: "iss_aliquota_acima",
      chave: `iss_aliquota_acima:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca,
      titulo: `ISS retido acima da alíquota do Simples — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, o ISS foi retido com alíquota maior que a devida em ${notasTexto(acima.length)} (base ${moeda(base)}). ` +
        `Para empresa do Simples, a alíquota da retenção é a parte do ISS na alíquota efetiva do mês anterior: ${pctTexto(devida)}. ` +
        `A diferença, cerca de ${moeda(total)}, foi paga a mais ao município: dá para pedir a restituição até ${formatarData(prazo)} ` +
        `e corrigir a alíquota informada nas próximas notas.`,
      valor_base: base.toFixed(2),
      valor_estimado: total.toFixed(2),
      memoria: [
        ...memoriaBase,
        { rotulo: "Alíquota devida na retenção", valor: pctTexto(devida) },
        { rotulo: "Notas com alíquota maior", valor: `${notasTexto(acima.length)}, base ${moeda(base)}` },
        { rotulo: "ISS retido a mais (base × diferença de alíquota)", valor: moeda(total) },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(acima),
      fontes: [FONTES_SERVICOS.aliquotaRetencao, FONTES_SERVICOS.anexosServicos, FONTES_SERVICOS.restituicao],
    });
  }
  if (abaixo.length) {
    const total = centavos(abaixo.reduce((a, x) => a.plus(x.valor), new Decimal(0)));
    const base = centavos(abaixo.reduce((a, x) => a.plus(baseIss(x.n)), new Decimal(0)));
    achados.push({
      regra: "iss_aliquota_abaixo",
      chave: `iss_aliquota_abaixo:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca,
      titulo: `ISS retido abaixo da alíquota devida — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, o ISS foi retido com alíquota menor que a devida em ${notasTexto(abaixo.length)} (base ${moeda(base)}). ` +
        `A alíquota da retenção deveria ser ${pctTexto(devida)} (parte do ISS na alíquota efetiva do mês anterior). ` +
        `A diferença, cerca de ${moeda(total)}, continua devida pela empresa ao município, em guia própria. Corrija a alíquota nas próximas notas.`,
      valor_base: base.toFixed(2),
      valor_estimado: total.toFixed(2),
      memoria: [
        ...memoriaBase,
        { rotulo: "Alíquota devida na retenção", valor: pctTexto(devida) },
        { rotulo: "Notas com alíquota menor", valor: `${notasTexto(abaixo.length)}, base ${moeda(base)}` },
        { rotulo: "ISS que falta pagar (base × diferença de alíquota)", valor: moeda(total) },
      ],
      referencias: referencias(abaixo),
      fontes: [FONTES_SERVICOS.aliquotaRetencao, FONTES_SERVICOS.anexosServicos],
    });
  }
  return achados;
}

// IR e contribuições retidos de empresa do Simples ------------------------------
function federaisRetidosSimples(c: string, saidas: NotaServico[], regime: string): AchadoCalculado[] {
  const marcadas = saidas.map((n) => ({ n, r: retencoesFederais(n) })).filter((x) => x.r.irrf.plus(x.r.csrf).gte("0.01"));
  if (!marcadas.length) return [];
  const irrf = centavos(marcadas.reduce((a, x) => a.plus(x.r.irrf), new Decimal(0)));
  const csrf = centavos(marcadas.reduce((a, x) => a.plus(x.r.csrf), new Decimal(0)));
  const total = irrf.plus(csrf);
  const receita = centavos(marcadas.reduce((a, x) => a.plus(num(x.n.valor)), new Decimal(0)));
  const prazo = prazoRestituicao(c);
  const partes = [irrf.gt(0) ? `IR ${moeda(irrf)}` : null, csrf.gt(0) ? `PIS, Cofins e CSLL ${moeda(csrf)}` : null].filter(Boolean).join("; ");
  return [
    {
      regra: "retencao_federal_simples",
      chave: `retencao_federal_simples:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca: regime === "mei" ? "media" : "alta",
      titulo: `IR e contribuições retidos de empresa do Simples — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, os tomadores retiveram ${moeda(total)} de tributos federais em ${notasTexto(marcadas.length)} da empresa (${partes}). ` +
        `Empresa do Simples Nacional não sofre essas retenções: o valor saiu do que a empresa recebeu sem ser devido. ` +
        `Peça aos tomadores que parem de reter (com a declaração de optante do Simples) e avalie a recuperação dos valores até ${formatarData(prazo)}.`,
      valor_base: receita.toFixed(2),
      valor_estimado: total.toFixed(2),
      memoria: [
        { rotulo: "Notas com retenção federal", valor: `${notasTexto(marcadas.length)}, ${moeda(receita)} em serviços` },
        ...(irrf.gt(0) ? [{ rotulo: "IR retido na fonte", valor: moeda(irrf) }] : []),
        ...(csrf.gt(0) ? [{ rotulo: "PIS, Cofins e CSLL retidos", valor: moeda(csrf) }] : []),
        { rotulo: "Total retido sem ser devido", valor: moeda(total) },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(
        marcadas.map(({ n, r }) => ({
          n,
          valor: r.irrf.plus(r.csrf),
          motivo: [r.irrf.gt(0) ? `IR ${moeda(r.irrf)}` : null, r.csrf.gt(0) ? `PIS/Cofins/CSLL ${moeda(r.csrf)}` : null].filter(Boolean).join("; "),
        })),
      ),
      fontes: [FONTES_SERVICOS.irrfSimples, FONTES_SERVICOS.csrfSimples, FONTES_SERVICOS.restituicao],
    },
  ];
}

// INSS (11%) retido de empresa do Simples fora do Anexo IV ----------------------
function inssRetidoSimples(c: string, saidas: NotaServico[], s: MesSimplesServicos | null, regime: string): AchadoCalculado[] {
  // Anexo IV informado: a retenção é devida
  if (s?.anexoInformado && s.anexo === "IV") return [];
  const marcadas = saidas.filter((n) => num(t(n).ret_cp).gte("0.01"));
  if (!marcadas.length) return [];
  const total = centavos(soma(marcadas, (n) => num(t(n).ret_cp)));
  const receita = centavos(soma(marcadas, (n) => num(n.valor)));
  const prazo = prazoRestituicao(c);
  const anexoTexto =
    regime === "mei"
      ? "a empresa é MEI"
      : s?.anexoInformado
        ? `os serviços da empresa estão no Anexo ${s.anexo}`
        : "o anexo dos serviços não foi informado nos Cálculos (confira se a atividade é do Anexo IV)";
  return [
    {
      regra: "inss_retido_simples",
      chave: `inss_retido_simples:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "oportunidade",
      confianca: s?.anexoInformado && regime !== "mei" ? "alta" : "conferir",
      titulo: `INSS retido de empresa do Simples — ${mes(c)}`,
      resumo:
        `Em ${mesLongo(c)}, os tomadores retiveram ${moeda(total)} de INSS em ${notasTexto(marcadas.length)} da empresa. ` +
        `No Simples Nacional, só os serviços do Anexo IV sofrem essa retenção, e ${anexoTexto}. ` +
        `Se a retenção não era devida, o valor pode ser compensado ou restituído até ${formatarData(prazo)}; confira o enquadramento e a DCTFWeb.`,
      valor_base: receita.toFixed(2),
      valor_estimado: total.toFixed(2),
      memoria: [
        { rotulo: "Notas com INSS retido", valor: `${notasTexto(marcadas.length)}, ${moeda(receita)} em serviços` },
        { rotulo: "INSS retido", valor: moeda(total) },
        { rotulo: "Enquadramento", valor: anexoTexto.charAt(0).toUpperCase() + anexoTexto.slice(1) },
        { rotulo: "Prazo para pedir a restituição", valor: formatarData(prazo) },
      ],
      referencias: referencias(marcadas.map((n) => ({ n, valor: num(t(n).ret_cp), motivo: `INSS retido de ${moeda(num(t(n).ret_cp))}` }))),
      fontes: [FONTES_SERVICOS.inssSimples, FONTES_SERVICOS.restituicao],
    },
  ];
}

// Regime do Simples na NFS-e diferente do cadastro ------------------------------
function regimeDivergente(c: string, saidas: NotaServico[], regime: string | null): AchadoCalculado[] {
  if (!regime) return [];
  const simples = regime === "simples_nacional" || regime === "mei";
  let marcadas: NotaServico[] = [];
  let titulo = "";
  let resumo = "";
  if (simples) {
    marcadas = saidas.filter((n) => t(n).op_simp_nac === "1");
    titulo = `NFS-e emitidas como "não optante do Simples" — ${mes(c)}`;
    resumo =
      `Em ${mesLongo(c)}, ${notasTexto(marcadas.length)} saíram como se a empresa não fosse do Simples Nacional. ` +
      `Isso leva o tomador a reter IR, PIS, Cofins e CSLL e a usar a alíquota cheia do ISS. Corrija o regime no cadastro do emissor de NFS-e.`;
  } else if (REGIME_NORMAL.has(regime)) {
    marcadas = saidas.filter((n) => ["2", "3"].includes(t(n).op_simp_nac ?? ""));
    titulo = `NFS-e emitidas como optante do Simples — ${mes(c)}`;
    resumo =
      `Em ${mesLongo(c)}, ${notasTexto(marcadas.length)} saíram como se a empresa fosse do Simples Nacional, mas ela está no ` +
      `${NOME_REGIME[regime] ?? regime}. O tomador deixa de reter os tributos devidos e a empresa pode ser cobrada. Corrija o regime no cadastro do emissor.`;
  }
  if (!marcadas.length) return [];
  const total = centavos(soma(marcadas, (n) => num(n.valor)));
  return [
    {
      regra: "nfse_regime_divergente",
      chave: `nfse_regime_divergente:${c.slice(0, 7)}`,
      competencia: c,
      tipo: "risco",
      confianca: "alta",
      titulo,
      resumo,
      valor_base: total.toFixed(2),
      valor_estimado: null,
      memoria: [
        { rotulo: "Regime da empresa no mês (cadastro do portal)", valor: simples ? (regime === "mei" ? "MEI" : "Simples Nacional") : (NOME_REGIME[regime] ?? regime) },
        { rotulo: "Notas com o regime diferente", valor: `${notasTexto(marcadas.length)}, ${moeda(total)}` },
      ],
      referencias: referencias(
        marcadas.map((n) => ({ n, valor: num(n.valor), motivo: t(n).op_simp_nac === "1" ? "emitida como não optante" : "emitida como optante do Simples" })),
      ),
      fontes: [FONTES_SERVICOS.leiauteNfse],
    },
  ];
}

export const REGRAS_SERVICOS = [
  "iss_retido_simples",
  "iss_aliquota_acima",
  "iss_aliquota_abaixo",
  "retencao_federal_simples",
  "inss_retido_simples",
  "nfse_regime_divergente",
] as const;

