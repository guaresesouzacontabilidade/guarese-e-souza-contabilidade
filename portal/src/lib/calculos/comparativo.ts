import Decimal from "decimal.js";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { somarMeses } from "@/lib/competencia";
import { formatarCompetencia } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { basesPresuncao, dasSimples, folhaDoMes, irpjSobre, proLabores, receitaDoMes, type DadosPrevisao, type ParametrosCalculo, type ReceitaMes } from "./previsao";
import { CBS_IBS_2026, FOLHA, FONTE_SIMPLES, IRPJ_CSLL, LC224, PIS_COFINS, SIMPLES, type Fonte } from "./tabelas";

/**
 * Comparativo de regimes (planejamento tributário): quanto a empresa teria
 * pago em cada regime nos 12 meses até uma competência, com os mesmos dados da
 * previsão (notas enviadas, receita informada, colaboradores e pró-labore).
 * O que os dados não dizem (margem de lucro, ICMS fora do Simples, ISS) vem
 * das premissas informadas pela equipe; sem elas o regime fica incompleto.
 */

export const REGIMES_COMPARADOS = ["simples_nacional", "lucro_presumido", "lucro_real"] as const;
export type RegimeComparado = (typeof REGIMES_COMPARADOS)[number];

export const TRIBUTOS_COMPARADOS = [
  { chave: "das", rotulo: "DAS (Simples Nacional)" },
  { chave: "pis", rotulo: "PIS" },
  { chave: "cofins", rotulo: "Cofins" },
  { chave: "irpj", rotulo: "IRPJ" },
  { chave: "csll", rotulo: "CSLL" },
  { chave: "icms", rotulo: "ICMS" },
  { chave: "iss", rotulo: "ISS" },
  { chave: "ipi", rotulo: "IPI" },
  { chave: "patronal", rotulo: "INSS patronal (folha e pró-labore)" },
] as const;
export type ChaveTributo = (typeof TRIBUTOS_COMPARADOS)[number]["chave"];

/** calculado: valor estimado; no_das: incluído no DAS; nao_se_aplica: não há; falta: depende de uma premissa não informada. */
export type SituacaoTributo = "calculado" | "no_das" | "nao_se_aplica" | "falta";

export interface TributoComparado {
  situacao: SituacaoTributo;
  valor: Decimal;
  /** Como foi calculado; quando falta premissa, o que falta informar. */
  detalhe: string | null;
}

export interface ResultadoRegime {
  regime: RegimeComparado;
  rotulo: string;
  tributos: Record<ChaveTributo, TributoComparado>;
  total: Decimal;
  /** Total de cada mês, na ordem de `meses`. */
  porMes: Decimal[];
  /** Total ÷ receita do período (fração). */
  carga: Decimal | null;
  /** O que falta informar (ex.: "a margem de lucro"). */
  faltando: string[];
  impedimento: string | null;
  /** Incompleto, mas o que já foi calculado passa do total do melhor regime: não tem como sair mais barato. */
  jaMaisCaro: boolean;
}

export interface PremissasComparativo {
  /** Lucro antes do IRPJ e da CSLL, em % da receita (Lucro Real). */
  margemLucro: Decimal | null;
  /** Alíquota média do ICMS nas vendas tributadas fora do Simples, em %. Sem ela, usa a média das notas (quando há ICMS destacado). */
  aliquotaIcms: Decimal | null;
  /** Alíquota do ISS do município, em %. Sem ela, usa a da configuração. */
  aliquotaIss: Decimal | null;
  /** Créditos de PIS/Cofins sobre as compras das notas de entrada (Lucro Real). */
  creditosPisCofins: boolean;
}

export interface Comparativo {
  meses: string[];
  regimeAtual: string | null;
  regimeAtualRotulo: string;
  receita: { mercadorias: Decimal; servicos: Decimal; total: Decimal; porMes: Decimal[]; mesesSemDados: string[] };
  regimes: ResultadoRegime[];
  /** Regime completo e permitido de menor total. */
  melhor: RegimeComparado | null;
  /** Quanto o melhor regime custaria a menos que o atual no período. */
  economia: Decimal | null;
  /** Alíquota média do ICMS destacado nas notas de venda (quando há). */
  sugestaoIcms: Decimal | null;
  /** A empresa vende mercadorias (ou é contribuinte do ICMS) / presta serviços: as premissas de ICMS e ISS valem. */
  aplicaIcms: boolean;
  aplicaIss: boolean;
  memoria: { rotulo: string; valor: string }[];
  avisos: string[];
  fontes: Fonte[];
}

const CEM = new Decimal(100);
const ZERO = new Decimal(0);
/** Encargos da folha incluem o 13º salário e o 1/3 de férias proporcionais (1/12 e 1/36 da folha). */
const FATOR_13_FERIAS = new Decimal(1).plus(new Decimal(1).div(12)).plus(new Decimal(1).div(36));

const moeda = (v: Decimal) => formatarMoeda(centavos(v));
const soma = (l: Decimal[]) => l.reduce((s, v) => s.plus(v), ZERO);

export function textoPercentual(v: Decimal | number | string, casas = 2): string {
  return `${dec(v).toFixed(casas).replace(/\.?0+$/, "").replace(".", ",")}%`;
}

function tributo(situacao: SituacaoTributo, valor: Decimal = ZERO, detalhe: string | null = null): TributoComparado {
  return { situacao, valor: situacao === "calculado" ? centavos(valor) : ZERO, detalhe };
}

/** Saldo mês a mês: o que sobra de crédito passa para o mês seguinte. */
function comSaldoCredor(debitos: Decimal[], creditos: Decimal[]): Decimal[] {
  let saldo = ZERO;
  return debitos.map((d, i) => {
    const v = d.minus(creditos[i]).minus(saldo);
    if (v.lt(0)) {
      saldo = v.abs();
      return ZERO;
    }
    saldo = ZERO;
    return v;
  });
}

/** Distribui um valor entre os meses proporcionalmente aos pesos (para a tabela mês a mês). */
function distribuir(valor: Decimal, pesos: Decimal[]): Decimal[] {
  const total = soma(pesos);
  if (total.lte(0)) return pesos.map(() => ZERO);
  return pesos.map((p) => valor.times(p).div(total));
}

function trimestre(c: string) {
  const ano = c.slice(0, 4);
  const t = Math.floor((Number(c.slice(5, 7)) - 1) / 3);
  const inicio = `${ano}-${String(t * 3 + 1).padStart(2, "0")}-01`;
  return { chave: `${ano}-${t + 1}`, inicio, fim: somarMeses(inicio, 2) };
}

export function compararRegimes(dados: DadosPrevisao, ate: string, premissas: PremissasComparativo): Comparativo {
  const p = dados.parametros as ParametrosCalculo;
  const fim = `${ate.slice(0, 7)}-01`;
  const meses = Array.from({ length: 12 }, (_, i) => somarMeses(fim, i - 11));
  const porMes = new Map(dados.meses.map((m) => [`${String(m.competencia).slice(0, 7)}-01`, m]));
  const inicioAtividade = p.inicio_atividade ? `${p.inicio_atividade.slice(0, 7)}-01` : null;
  const ativo = (c: string) => !inicioAtividade || c >= inicioAtividade;
  const avisos: string[] = [];
  const fontes: Fonte[] = [];
  const addFonte = (f: Fonte) => {
    if (!fontes.some((x) => x.titulo === f.titulo)) fontes.push(f);
  };

  // Receita e folha do período
  const receitas: ReceitaMes[] = meses.map((c) => receitaDoMes(porMes.get(c)));
  const merc = receitas.map((r) => r.mercadorias);
  const serv = receitas.map((r) => r.servicos);
  const total = receitas.map((r) => r.total);
  const receitaTotal = soma(total);
  const mercTotal = soma(merc);
  const servTotal = soma(serv);
  const mesesSemDados = meses.filter((c, i) => ativo(c) && receitas[i].fonte === "sem_dados");
  const folhas = meses.map((c) => folhaDoMes(dados, c).total);
  const proLaboreMensal = soma(proLabores(p));
  const proLabore = meses.map((c) => (ativo(c) ? proLaboreMensal : ZERO));
  const pesos = total.map((t) => Decimal.max(t, 0));

  const patronal = (tipo: "geral" | "simples_iv") =>
    meses.map((_, i) => {
      const base = folhas[i].times(FATOR_13_FERIAS);
      let v = base.plus(proLabore[i]).times(FOLHA.cpp).div(CEM);
      v = v.plus(base.times(dec(p.rat).times(dec(p.fap))).div(CEM));
      if (tipo === "geral") v = v.plus(base.times(dec(p.terceiros)).div(CEM));
      return v;
    });
  const temFolha = soma(folhas).gt(0) || soma(proLabore).gt(0);
  if (temFolha) addFonte(FOLHA.fonteCpp);

  // ICMS fora do Simples: alíquota informada ou média das notas; créditos das notas de entrada
  const vendasTributadas = receitas.map((r) => Decimal.max(0, r.mercadorias.minus(r.vendasSt)));
  const icmsDestacado = soma(receitas.map((r) => r.icmsVendas));
  const baseTributada = soma(vendasTributadas);
  const sugestaoIcms = baseTributada.gt(0) && icmsDestacado.gt(0) ? icmsDestacado.div(baseTributada).times(CEM).toDecimalPlaces(2) : null;
  const aliqIcms = premissas.aliquotaIcms ?? sugestaoIcms;
  const temIcms = dados.empresa.contribuinte_icms || mercTotal.gt(0);
  const icmsDebito = vendasTributadas.map((v) => (aliqIcms ? v.times(aliqIcms).div(CEM) : ZERO));
  const icmsCredito = meses.map((c) => dec(porMes.get(c)?.icms_credito));
  const icmsMes = comSaldoCredor(icmsDebito, icmsCredito);
  const icms: TributoComparado = !temIcms
    ? tributo("nao_se_aplica")
    : aliqIcms
      ? tributo("calculado", soma(icmsMes), `${textoPercentual(aliqIcms)} sobre ${moeda(baseTributada)} de vendas, menos ${moeda(soma(icmsCredito))} de ICMS das notas de entrada`)
      : tributo("falta", ZERO, "a alíquota média do ICMS");

  // ISS fora do Simples (inclusive o retido pelos tomadores, que também sai da receita da empresa)
  const aliqIss = premissas.aliquotaIss ?? (p.aliquota_iss == null ? null : dec(p.aliquota_iss));
  const issMes = serv.map((s) => (aliqIss ? s.times(aliqIss).div(CEM) : ZERO));
  const iss: TributoComparado = servTotal.lte(0)
    ? tributo("nao_se_aplica")
    : aliqIss
      ? tributo("calculado", soma(issMes), `${textoPercentual(aliqIss)} sobre ${moeda(servTotal)} de serviços`)
      : tributo("falta", ZERO, "a alíquota do ISS");

  // IPI fora do Simples (débitos e créditos das notas)
  const ipiMes = p.calcular_ipi
    ? comSaldoCredor(
        meses.map((c) => dec(porMes.get(c)?.ipi_debito)),
        meses.map((c) => dec(porMes.get(c)?.ipi_credito)),
      )
    : meses.map(() => ZERO);
  const ipi: TributoComparado = p.calcular_ipi ? tributo("calculado", soma(ipiMes), "Débitos menos créditos das notas fiscais") : tributo("nao_se_aplica");

  // PIS/Cofins: o ICMS destacado nas vendas fica fora da base (STF, Tema 69)
  const basePisCofins = total.map((t, i) => Decimal.max(0, t.minus(icmsDebito[i])));

  const montar = (
    regime: RegimeComparado,
    t: Partial<Record<ChaveTributo, TributoComparado>>,
    mensais: Decimal[][],
    impedimento: string | null = null,
  ): ResultadoRegime => {
    const tributos = Object.fromEntries(TRIBUTOS_COMPARADOS.map(({ chave }) => [chave, t[chave] ?? tributo("nao_se_aplica")])) as Record<ChaveTributo, TributoComparado>;
    const totalRegime = soma(Object.values(tributos).map((x) => x.valor));
    const faltando = [
      ...new Set(TRIBUTOS_COMPARADOS.filter(({ chave }) => tributos[chave].situacao === "falta").map(({ chave }) => tributos[chave].detalhe ?? chave)),
    ];
    // Mês a mês (arredondado); a diferença de centavos fica no último mês para fechar com o total
    const porMesRegime = meses.map((_, i) => centavos(soma(mensais.map((m) => m[i]))));
    const diferenca = totalRegime.minus(soma(porMesRegime));
    if (!diferenca.isZero()) porMesRegime[porMesRegime.length - 1] = porMesRegime[porMesRegime.length - 1].plus(diferenca);
    return {
      regime,
      rotulo: REGIMES[regime],
      tributos,
      total: centavos(totalRegime),
      porMes: porMesRegime,
      carga: receitaTotal.gt(0) ? totalRegime.div(receitaTotal) : null,
      faltando,
      impedimento,
      jaMaisCaro: false,
    };
  };

  // ---------------------------------------------------------------------------
  // Simples Nacional (mesmo cálculo da previsão, mês a mês, com a RBT12 de cada mês).
  // O ISS retido pelos tomadores entra no custo: no DAS ele é descontado, mas é pago pelo tomador com o dinheiro da empresa.
  // ---------------------------------------------------------------------------
  addFonte(FONTE_SIMPLES);
  const dadosSimples: DadosPrevisao = { ...dados, meses: dados.meses.map((m) => ({ ...m, servicos_retido: 0 })) };
  const simplesMes = meses.map((c) => dasSimples(dadosSimples, c));
  const das = simplesMes.map((s) => s.valor);
  const anexoIv = p.anexo_servicos === "IV" && servTotal.gt(0);
  const patronalIv = anexoIv ? patronal("simples_iv") : meses.map(() => ZERO);
  const maiorRbt12 = Decimal.max(receitaTotal, ...simplesMes.map((s) => s.rbt12));
  const simples = montar(
    "simples_nacional",
    {
      das: tributo("calculado", soma(das), "Inclui IRPJ, CSLL, PIS, Cofins, CPP, ICMS e ISS (e IPI na indústria)"),
      pis: tributo("no_das"),
      cofins: tributo("no_das"),
      irpj: tributo("no_das"),
      csll: tributo("no_das"),
      icms: temIcms ? tributo("no_das") : tributo("nao_se_aplica"),
      iss: servTotal.gt(0) ? tributo("no_das") : tributo("nao_se_aplica"),
      ipi: p.anexo_mercadorias === "II" && mercTotal.gt(0) ? tributo("no_das") : tributo("nao_se_aplica"),
      patronal: anexoIv
        ? tributo("calculado", soma(patronalIv), "Anexo IV: a contribuição patronal é paga fora do DAS")
        : temFolha
          ? tributo("no_das")
          : tributo("nao_se_aplica"),
    },
    [das, patronalIv],
    maiorRbt12.gt(SIMPLES.limite) ? `Receita acima do limite do Simples Nacional (${moeda(dec(SIMPLES.limite))} em 12 meses).` : null,
  );
  if (!simples.impedimento && maiorRbt12.gt(SIMPLES.sublimite)) {
    avisos.push(
      `A receita passou do sublimite de ${moeda(dec(SIMPLES.sublimite))}: no Simples, o ICMS e o ISS passam a ser pagos fora do DAS, o que não está neste comparativo.`,
    );
  }
  const semDadosRbt12 = [...new Set(simplesMes.flatMap((s) => s.mesesSemDados))].filter((c) => c < meses[0]).sort();
  if (semDadosRbt12.length) {
    avisos.push(
      `Para a alíquota do Simples (receita dos 12 meses anteriores a cada mês), faltam receitas de ${semDadosRbt12.map((c) => formatarCompetencia(c)).join(", ")}. ` +
        "Se a empresa já faturava, informe-as em Cálculos → Configuração; sem elas a alíquota do Simples pode ficar menor que a real.",
    );
  }
  if (p.anexo_servicos === "V" && p.fator_r && servTotal.gt(0) && simplesMes.some((s) => s.folhaEstimada)) {
    avisos.push("Fator R: a folha dos meses anteriores foi estimada pelo cadastro de colaboradores e pelo pró-labore.");
  }

  // ---------------------------------------------------------------------------
  // Lucro Presumido
  // ---------------------------------------------------------------------------
  addFonte(PIS_COFINS.fonteCumulativo);
  addFonte(IRPJ_CSLL.fonte);
  const pisCum = basePisCofins.map((b) => b.times(PIS_COFINS.cumulativo.pis).div(CEM));
  const cofinsCum = basePisCofins.map((b) => b.times(PIS_COFINS.cumulativo.cofins).div(CEM));
  const irpjPres = meses.map(() => ZERO);
  const csllPres = meses.map(() => ZERO);
  let lc224 = false;
  const trimestres = new Map<string, { inicio: string; fim: string; indices: number[] }>();
  meses.forEach((c, i) => {
    const t = trimestre(c);
    if (!trimestres.has(t.chave)) trimestres.set(t.chave, { inicio: t.inicio, fim: t.fim, indices: [] });
    trimestres.get(t.chave)!.indices.push(i);
  });
  for (const t of trimestres.values()) {
    const m = soma(t.indices.map((i) => merc[i]));
    const s = soma(t.indices.map((i) => serv[i]));
    const receitaTrim = m.plus(s);
    let fatorIrpj = new Decimal(1);
    let fatorCsll = new Decimal(1);
    // LC 224/2025: limite trimestral proporcional aos meses do trimestre dentro do período
    const limite = dec(LC224.limiteTrimestral).times(t.indices.length).div(3);
    if (p.acrescimo_lc224 && t.fim.slice(0, 7) >= LC224.inicioIrpj && receitaTrim.gt(limite)) {
      const fracao = receitaTrim.minus(limite).div(receitaTrim).times(LC224.acrescimo).div(CEM);
      fatorIrpj = fatorIrpj.plus(fracao);
      if (t.inicio.slice(0, 7) >= LC224.inicioCsll) fatorCsll = fatorCsll.plus(fracao);
      lc224 = true;
    }
    const b = basesPresuncao(p, m, s);
    const irpj = irpjSobre(b.irpj.times(fatorIrpj), t.indices.length).total;
    const csll = b.csll.times(fatorCsll).times(IRPJ_CSLL.csll).div(CEM);
    const partes = t.indices.map((i) => pesos[i]);
    distribuir(irpj, partes).forEach((v, k) => (irpjPres[t.indices[k]] = v));
    distribuir(csll, partes).forEach((v, k) => (csllPres[t.indices[k]] = v));
  }
  if (lc224) addFonte(LC224.fonte);
  const patronalGeral = patronal("geral");
  const comuns = { icms, iss, ipi, patronal: temFolha ? tributo("calculado", soma(patronalGeral), "CPP 20%, RAT/FAP e terceiros") : tributo("nao_se_aplica") };
  const presumido = montar(
    "lucro_presumido",
    {
      pis: tributo("calculado", soma(pisCum), `${textoPercentual(PIS_COFINS.cumulativo.pis)} (cumulativo)`),
      cofins: tributo("calculado", soma(cofinsCum), `${textoPercentual(PIS_COFINS.cumulativo.cofins)} (cumulativo)`),
      irpj: tributo("calculado", soma(irpjPres), "Por trimestre, sobre a base presumida, com adicional de 10%"),
      csll: tributo("calculado", soma(csllPres), "Por trimestre, sobre a base presumida"),
      ...comuns,
    },
    [pisCum, cofinsCum, irpjPres, csllPres, icmsMes, issMes, ipiMes, patronalGeral],
  );

  // ---------------------------------------------------------------------------
  // Lucro Real (anual, sobre o lucro estimado pela margem)
  // ---------------------------------------------------------------------------
  addFonte(PIS_COFINS.fonteNaoCumulativo);
  const creditoBase = meses.map((c) => {
    const m = porMes.get(c);
    return premissas.creditosPisCofins && m ? Decimal.max(0, dec(m.compras).minus(dec(m.icms_compras))) : ZERO;
  });
  const pisNc = comSaldoCredor(
    basePisCofins.map((b) => b.times(PIS_COFINS.naoCumulativo.pis).div(CEM)),
    creditoBase.map((b) => b.times(PIS_COFINS.naoCumulativo.pis).div(CEM)),
  );
  const cofinsNc = comSaldoCredor(
    basePisCofins.map((b) => b.times(PIS_COFINS.naoCumulativo.cofins).div(CEM)),
    creditoBase.map((b) => b.times(PIS_COFINS.naoCumulativo.cofins).div(CEM)),
  );
  const margem = premissas.margemLucro;
  const lucro = margem ? receitaTotal.times(margem).div(CEM) : null;
  const mesesAtivos = Math.max(1, meses.filter(ativo).length);
  let irpjReal = meses.map(() => ZERO);
  let csllReal = meses.map(() => ZERO);
  if (lucro) {
    const base = Decimal.max(0, lucro);
    irpjReal = distribuir(irpjSobre(base, mesesAtivos).total, pesos);
    csllReal = distribuir(base.times(IRPJ_CSLL.csll).div(CEM), pesos);
  }
  const textoCreditos = premissas.creditosPisCofins ? `com créditos sobre ${moeda(soma(creditoBase))} de compras` : "sem créditos";
  const textoLucro = (aliquota: string) =>
    lucro && lucro.gt(0) ? `${aliquota} sobre o lucro de ${moeda(lucro)}` : "Sem lucro no período: não há imposto sobre o lucro";
  const real = montar(
    "lucro_real",
    {
      pis: tributo("calculado", soma(pisNc), `${textoPercentual(PIS_COFINS.naoCumulativo.pis)} (não cumulativo), ${textoCreditos}`),
      cofins: tributo("calculado", soma(cofinsNc), `${textoPercentual(PIS_COFINS.naoCumulativo.cofins)} (não cumulativo), ${textoCreditos}`),
      irpj: lucro ? tributo("calculado", soma(irpjReal), textoLucro("15% e adicional de 10%")) : tributo("falta", ZERO, "a margem de lucro"),
      csll: lucro ? tributo("calculado", soma(csllReal), textoLucro("9%")) : tributo("falta", ZERO, "a margem de lucro"),
      ...comuns,
    },
    [pisNc, cofinsNc, irpjReal, csllReal, icmsMes, issMes, ipiMes, patronalGeral],
  );

  const regimes = [simples, presumido, real];
  const elegiveis = regimes.filter((r) => !r.impedimento && r.faltando.length === 0);
  const melhor = receitaTotal.gt(0) && elegiveis.length ? elegiveis.reduce((a, b) => (b.total.lt(a.total) ? b : a)).regime : null;
  // O que falta só aumenta o total: se a parte calculada já passa do melhor, o regime não tem como sair mais barato
  if (melhor) {
    const totalMelhor = regimes.find((r) => r.regime === melhor)!.total;
    for (const r of regimes) r.jaMaisCaro = r.faltando.length > 0 && r.total.gte(totalMelhor);
  }
  const regimeAtual = dados.empresa.regime;
  const atual = regimes.find((r) => r.regime === regimeAtual);
  const economia =
    melhor && atual && atual.regime !== melhor && !atual.impedimento && atual.faltando.length === 0
      ? centavos(atual.total.minus(regimes.find((r) => r.regime === melhor)!.total))
      : null;

  // Memória do cálculo (premissas)
  const memoria: { rotulo: string; valor: string }[] = [
    { rotulo: "Período", valor: `${formatarCompetencia(meses[0])} a ${formatarCompetencia(fim)}` },
    {
      rotulo: "Receita do período",
      valor: `${moeda(receitaTotal)}${mercTotal.gt(0) && servTotal.gt(0) ? ` (vendas ${moeda(mercTotal)} e serviços ${moeda(servTotal)})` : ""}`,
    },
  ];
  if (temFolha) {
    memoria.push({
      rotulo: "Folha e pró-labore do período",
      valor: `Salários ${moeda(soma(folhas))} e pró-labore ${moeda(soma(proLabore))}; os encargos incluem 13º e 1/3 de férias proporcionais`,
    });
  }
  const anexosServ = simplesMes.filter((_, i) => serv[i].gt(0)).map((s) => s.anexoServicos);
  const simplesTexto = [
    mercTotal.gt(0) ? `vendas no Anexo ${p.anexo_mercadorias}` : null,
    servTotal.gt(0)
      ? p.anexo_servicos === "V" && p.fator_r
        ? `serviços pelo Fator R (Anexo III em ${anexosServ.filter((a) => a === "III").length} e Anexo V em ${anexosServ.filter((a) => a === "V").length} ${anexosServ.length === 1 ? "mês" : "meses"})`
        : `serviços no Anexo ${p.anexo_servicos}`
      : null,
  ].filter(Boolean);
  if (simplesTexto.length) memoria.push({ rotulo: "Simples Nacional", valor: simplesTexto.join("; ") });
  memoria.push({
    rotulo: "Lucro Presumido",
    valor:
      `presunção do IRPJ de ${textoPercentual(dec(p.presuncao_irpj_mercadorias))} (vendas) e ${textoPercentual(dec(p.presuncao_irpj_servicos))} (serviços); ` +
      `da CSLL de ${textoPercentual(dec(p.presuncao_csll_mercadorias))} e ${textoPercentual(dec(p.presuncao_csll_servicos))}` +
      (lc224 ? "; acréscimo da LC 224/2025 aplicado" : p.acrescimo_lc224 ? "" : "; acréscimo da LC 224/2025 desmarcado na configuração"),
  });
  memoria.push({
    rotulo: "Lucro Real",
    valor: lucro
      ? `margem de ${textoPercentual(margem!)} da receita (lucro de ${moeda(lucro)} antes do IRPJ e da CSLL); PIS/Cofins ${textoCreditos}`
      : `falta a margem de lucro; PIS/Cofins ${textoCreditos}`,
  });
  if (temIcms) {
    memoria.push({
      rotulo: "ICMS fora do Simples",
      valor: aliqIcms
        ? `${textoPercentual(aliqIcms)} sobre as vendas tributadas (${premissas.aliquotaIcms ? "informada" : "média do ICMS destacado nas notas"}), menos o ICMS das notas de entrada; vendas com ICMS-ST ficam de fora`
        : "falta a alíquota média do ICMS nas vendas",
    });
  }
  if (servTotal.gt(0)) {
    memoria.push({
      rotulo: "ISS fora do Simples",
      valor: aliqIss ? `${textoPercentual(aliqIss)} sobre todos os serviços (${premissas.aliquotaIss ? "informada" : "da configuração"})` : "falta a alíquota do ISS",
    });
  }
  if (temFolha) {
    memoria.push({
      rotulo: "Encargos fora do Simples",
      valor: `CPP de ${textoPercentual(FOLHA.cpp)} (folha e pró-labore), RAT ${textoPercentual(dec(p.rat))} × FAP ${dec(p.fap).toFixed(4).replace(".", ",")} e terceiros ${textoPercentual(dec(p.terceiros))} (este só no Presumido e no Real)`,
    });
  }

  if (mesesSemDados.length) {
    avisos.unshift(
      `Sem notas nem receita informada em ${mesesSemDados.map((c) => formatarCompetencia(c)).join(", ")}: esses meses entram com receita zero.`,
    );
  }
  if (p.anexo_mercadorias === "II" && mercTotal.gt(0) && soma(ipiMes).isZero()) {
    avisos.push("Indústria: o IPI fora do Simples não foi estimado (as notas do período não trazem IPI destacado ou o cálculo do IPI está desmarcado em Configuração).");
  }
  if (dados.empresa.tem_empregados && soma(folhas).isZero()) {
    avisos.push("A empresa tem empregados, mas nenhum colaborador está cadastrado no período: cadastre em Cálculos → Colaboradores para incluir a folha.");
  }
  if (dados.empresa.tem_pro_labore && proLaboreMensal.isZero()) {
    avisos.push("A empresa tem pró-labore, mas o valor não foi informado em Cálculos → Configuração.");
  }
  avisos.push(
    "FGTS e os descontos dos empregados e sócios (INSS e IRRF) são iguais em todos os regimes e não entram no comparativo.",
    "Não entram: ICMS-ST e DIFAL, produtos monofásicos, isenções, retenções, incentivos fiscais, créditos de PIS/Cofins sobre energia, aluguéis e depreciação, nem adições, exclusões e prejuízos do Lucro Real.",
    "O regime vale para o ano todo e só muda no começo do ano: a opção pelo Simples Nacional é feita em janeiro; a saída do Simples comunicada em janeiro vale para o mesmo ano (depois, só para o ano seguinte); o Lucro Presumido e o Real são definidos pelo primeiro pagamento do ano. Algumas atividades e situações impedem o Simples; o escritório confere antes.",
    "Reforma tributária: a partir de 2027 o PIS e a Cofins dão lugar à CBS e o IPI é zerado para a maioria dos produtos. Este comparativo usa as regras de 2026; para o regime de 2027, considere também a opção de pagar a CBS e o IBS fora do DAS.",
  );
  addFonte(CBS_IBS_2026);

  return {
    meses,
    regimeAtual,
    regimeAtualRotulo: regimeAtual ? (REGIMES[regimeAtual] ?? regimeAtual) : "não informado",
    receita: { mercadorias: centavos(mercTotal), servicos: centavos(servTotal), total: centavos(receitaTotal), porMes: total.map((t) => centavos(t)), mesesSemDados },
    regimes,
    melhor,
    economia,
    sugestaoIcms,
    aplicaIcms: temIcms,
    aplicaIss: servTotal.gt(0),
    memoria,
    avisos,
    fontes,
  };
}
