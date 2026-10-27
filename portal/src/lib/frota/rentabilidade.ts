import Decimal from "decimal.js";
import { dec } from "@/lib/dinheiro";

/**
 * Rentabilidade da frota: o resultado líquido de cada veículo no período.
 *
 *   Frete (faturamento)
 *   − deduções do frete (ICMS, quebra, carga/descarga)
 *   − comissão do motorista
 *   − despesas do caminhão (combustível, Arla, pneus, manutenção, pedágio, taxas)
 *   = margem de contribuição das viagens
 *   − custos fixos do mês (salário e encargos do motorista, depreciação ou
 *     parcela, seguro, rastreador/IPVA)
 *   − rateio do escritório (despesas administrativas, pela parte do frete)
 *   = resultado líquido
 *
 * O km rodado vem do hodômetro informado nos abastecimentos (o banco não deixa
 * o km voltar nem saltar); a média km/l usa o método do tanque cheio.
 */

export type GrupoDespesa = "combustivel" | "arla" | "pneus" | "manutencao" | "pedagio" | "impostos" | "outros";

export const GRUPOS_DESPESA: Record<GrupoDespesa, string> = {
  combustivel: "Combustível",
  arla: "Arla 32",
  pneus: "Pneus",
  manutencao: "Manutenção",
  pedagio: "Pedágio",
  impostos: "Impostos e taxas",
  outros: "Outras despesas",
};

type Valor = number | string | null | undefined;

export interface VeiculoFrota {
  id: string;
  placa: string;
  descricao: string;
  tipo: string;
  km_inicial: Valor;
  custo_motorista_mensal: Valor;
  depreciacao_mensal: Valor;
  financiamento_mensal: Valor;
  seguro_mensal: Valor;
  outros_fixos_mensal: Valor;
}

export interface ViagemFrota {
  id: string;
  veiculo_id: string;
  data: string;
  cte_numero: string | null;
  remetente: string | null;
  origem: string | null;
  destinatario: string | null;
  destino: string | null;
  mercadoria: string | null;
  motorista: string | null;
  peso_kg: Valor;
  valor_frete: Valor;
  icms: Valor;
  comissao_motorista: Valor;
  quebra: Valor;
  outras_deducoes: Valor;
}

export interface DespesaFrota {
  id: string;
  veiculo_id: string;
  data: string;
  grupo: GrupoDespesa;
  fornecedor: string | null;
  documento: string | null;
  descricao: string;
  litros: Valor;
  km: Valor;
  valor: Valor;
}

export interface DespesaCalculada extends DespesaFrota {
  /** Km rodado desde o abastecimento anterior. */
  rodado: number | null;
  /** Média deste abastecimento (km/l, tanque cheio). */
  media: number | null;
  alerta: string | null;
}

export interface ResultadoVeiculo {
  veiculo: VeiculoFrota;
  viagens: ViagemFrota[];
  despesas: DespesaCalculada[];
  faturamento: number;
  deducoes: { icms: number; quebra: number; outras: number; total: number };
  comissao: number;
  porGrupo: Record<GrupoDespesa, number>;
  despesasVariaveis: number;
  /** Margem de contribuição das viagens (antes dos custos fixos e do rateio). */
  sobraViagens: number;
  fixos: { motorista: number; depreciacao: number; financiamento: number; seguro: number; outros: number; total: number };
  rateio: number;
  lucro: number;
  /** Lucro sobre o faturamento (%); null sem faturamento. */
  margem: number | null;
  km: { inicial: number | null; final: number | null; rodado: number | null };
  litros: number;
  mediaKmL: number | null;
  custoKm: number | null;
  receitaKm: number | null;
  lucroKm: number | null;
  semaforo: "verde" | "amarelo" | "vermelho" | "parado";
  alertas: string[];
}

export interface ResultadoFrota {
  veiculos: ResultadoVeiculo[];
  total: Omit<ResultadoVeiculo, "veiculo" | "viagens" | "despesas" | "semaforo" | "alertas"> & { viagens: number };
  /** Fração do mês considerada nos custos fixos (1 = mês inteiro). */
  fatorFixos: number;
}

const n = (v: Valor) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const d2 = (v: Decimal) => Number(v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
const somaDec = (vals: Valor[]) => vals.reduce<Decimal>((s, v) => s.plus(dec(v === null || v === undefined || v === "" ? 0 : v)), new Decimal(0));

/** Faixa normal da média de um caminhão (km/l); fora dela, o lançamento merece conferência. */
const MEDIA_MIN = 1.2;
const MEDIA_MAX = 4.5;

function semaforo(lucro: number, margem: number | null, faturamento: number): ResultadoVeiculo["semaforo"] {
  if (faturamento === 0) return "parado";
  if (lucro < 0) return "vermelho";
  if ((margem ?? 0) < 10) return "amarelo";
  return "verde";
}

export function calcularVeiculo(
  veiculo: VeiculoFrota,
  viagens: ViagemFrota[],
  despesas: DespesaFrota[],
  opcoes: { kmAntes: number | null; fatorFixos: number; rateio: number },
): ResultadoVeiculo {
  const faturamentoD = somaDec(viagens.map((v) => v.valor_frete));
  const icms = somaDec(viagens.map((v) => v.icms));
  const quebra = somaDec(viagens.map((v) => v.quebra));
  const outras = somaDec(viagens.map((v) => v.outras_deducoes));
  const comissao = somaDec(viagens.map((v) => v.comissao_motorista));
  const porGrupoD = Object.fromEntries(Object.keys(GRUPOS_DESPESA).map((g) => [g, new Decimal(0)])) as Record<GrupoDespesa, Decimal>;
  for (const dsp of despesas) porGrupoD[dsp.grupo] = porGrupoD[dsp.grupo].plus(dec(n(dsp.valor)));
  const variaveis = Object.values(porGrupoD).reduce((s, v) => s.plus(v), new Decimal(0));
  const sobra = faturamentoD.minus(icms).minus(quebra).minus(outras).minus(comissao).minus(variaveis);
  const f = opcoes.fatorFixos;
  const fixo = (v: Valor) => dec(n(v)).times(f);
  const fixos = {
    motorista: fixo(veiculo.custo_motorista_mensal),
    depreciacao: fixo(veiculo.depreciacao_mensal),
    financiamento: fixo(veiculo.financiamento_mensal),
    seguro: fixo(veiculo.seguro_mensal),
    outros: fixo(veiculo.outros_fixos_mensal),
  };
  const fixosTotal = Object.values(fixos).reduce((s, v) => s.plus(v), new Decimal(0));
  const rateio = dec(opcoes.rateio);
  const lucroD = sobra.minus(fixosTotal).minus(rateio);
  const faturamento = d2(faturamentoD);
  const lucro = d2(lucroD);
  const margem = faturamento > 0 ? Number(lucroD.dividedBy(faturamentoD).times(100).toFixed(1)) : null;

  // Hodômetro: leituras dos abastecimentos em ordem
  const ordenadas = [...despesas].sort((a, b) => a.data.localeCompare(b.data) || n(a.km) - n(b.km));
  const alertas: string[] = [];
  let anterior = opcoes.kmAntes ?? (veiculo.km_inicial !== null && veiculo.km_inicial !== undefined && veiculo.km_inicial !== "" ? n(veiculo.km_inicial) : null);
  const kmInicial = anterior;
  let primeiraSemBase = anterior === null;
  let litrosMedia = new Decimal(0);
  let litros = new Decimal(0);
  let kmFinal: number | null = null;
  let semKm = 0;
  const calculadas: DespesaCalculada[] = ordenadas.map((dsp) => {
    const km = dsp.km === null || dsp.km === undefined || dsp.km === "" ? null : n(dsp.km);
    const lt = n(dsp.litros);
    let rodado: number | null = null;
    let media: number | null = null;
    let alerta: string | null = null;
    if (dsp.grupo === "combustivel") {
      litros = litros.plus(lt);
      if (km === null) {
        semKm++;
      } else {
        if (anterior !== null) {
          rodado = km - anterior;
          if (lt > 0) media = Math.round((rodado / lt) * 100) / 100;
          if (!primeiraSemBase) litrosMedia = litrosMedia.plus(lt);
          if (media !== null && (media < MEDIA_MIN || media > MEDIA_MAX)) {
            alerta = `Média de ${media.toLocaleString("pt-BR")} km/l fora da faixa esperada (${MEDIA_MIN.toLocaleString("pt-BR")} a ${MEDIA_MAX.toLocaleString("pt-BR")} km/l): conferir o km ou os litros.`;
          }
        }
        primeiraSemBase = false;
        anterior = km;
        kmFinal = km;
      }
    } else if (km !== null) {
      anterior = Math.max(anterior ?? km, km);
      kmFinal = Math.max(kmFinal ?? km, km);
    }
    return { ...dsp, rodado, media, alerta };
  });
  const inicioKm = kmInicial ?? (calculadas.find((c) => c.km !== null && c.km !== undefined && c.km !== "")?.km as Valor);
  const inicio = inicioKm === null || inicioKm === undefined ? null : n(inicioKm);
  const kmRodado = inicio !== null && kmFinal !== null ? Math.max(kmFinal - inicio, 0) : null;
  const mediaKmL = kmRodado && litrosMedia.gt(0) ? Math.round((kmRodado / Number(litrosMedia.toString())) * 100) / 100 : null;
  const custoTotal = faturamentoD.minus(lucroD);
  const custoKm = kmRodado ? Number(custoTotal.dividedBy(kmRodado).toFixed(2)) : null;
  const receitaKm = kmRodado ? Number(faturamentoD.dividedBy(kmRodado).toFixed(2)) : null;
  const lucroKm = kmRodado ? Number(lucroD.dividedBy(kmRodado).toFixed(2)) : null;

  if (faturamento === 0 && fixosTotal.gt(0)) alertas.push("Veículo sem faturamento no período; os custos fixos permanecem.");
  if (lucro < 0 && faturamento > 0) alertas.push("Resultado negativo: o faturamento não cobriu os custos do período. Recomenda-se revisar o valor do frete por km e o consumo.");
  if (semKm) alertas.push(`${semKm} abastecimento(s) sem registro do hodômetro: o km percorrido e a média de consumo ficam incompletos.`);
  const foraDaMedia = calculadas.filter((c) => c.alerta).length;
  if (foraDaMedia) alertas.push(`${foraDaMedia} abastecimento(s) com média de consumo fora da faixa esperada: recomenda-se conferir o km e os litros lançados.`);
  if (porGrupoD.combustivel.gt(0) && faturamentoD.gt(0) && porGrupoD.combustivel.dividedBy(faturamentoD).gt(0.5)) {
    alertas.push("Combustível acima de 50% do faturamento: recomenda-se revisar o valor do frete e o consumo.");
  }

  return {
    veiculo,
    viagens: [...viagens].sort((a, b) => a.data.localeCompare(b.data)),
    despesas: calculadas,
    faturamento,
    deducoes: { icms: d2(icms), quebra: d2(quebra), outras: d2(outras), total: d2(icms.plus(quebra).plus(outras)) },
    comissao: d2(comissao),
    porGrupo: Object.fromEntries(Object.entries(porGrupoD).map(([g, v]) => [g, d2(v)])) as Record<GrupoDespesa, number>,
    despesasVariaveis: d2(variaveis),
    sobraViagens: d2(sobra),
    fixos: {
      motorista: d2(fixos.motorista),
      depreciacao: d2(fixos.depreciacao),
      financiamento: d2(fixos.financiamento),
      seguro: d2(fixos.seguro),
      outros: d2(fixos.outros),
      total: d2(fixosTotal),
    },
    rateio: d2(rateio),
    lucro,
    margem,
    km: { inicial: inicio, final: kmFinal, rodado: kmRodado },
    litros: d2(litros),
    mediaKmL,
    custoKm,
    receitaKm,
    lucroKm,
    semaforo: semaforo(lucro, margem, faturamento),
    alertas,
  };
}

/** Fração do mês para os custos fixos: mês em andamento conta só os dias até hoje. */
export function fatorDoMes(mes: string, hoje: string) {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  if (hoje.slice(0, 7) !== mes) return hoje.slice(0, 7) < mes ? 0 : 1;
  return Math.round((Number(hoje.slice(8, 10)) / dias) * 10000) / 10000;
}

export function calcularFrota(
  veiculos: VeiculoFrota[],
  viagens: ViagemFrota[],
  despesas: DespesaFrota[],
  opcoes: { kmAntes: Record<string, number | null>; fatorFixos: number; rateioTotal: number },
): ResultadoFrota {
  const fatTotal = somaDec(viagens.map((v) => v.valor_frete));
  const resultados = veiculos.map((v) => {
    const vi = viagens.filter((x) => x.veiculo_id === v.id);
    const fat = somaDec(vi.map((x) => x.valor_frete));
    // Rateio do escritório pela parte de cada caminhão no frete da frota
    const rateio = fatTotal.gt(0) ? Number(dec(opcoes.rateioTotal).times(fat).dividedBy(fatTotal).toFixed(2)) : 0;
    return calcularVeiculo(
      v,
      vi,
      despesas.filter((x) => x.veiculo_id === v.id),
      { kmAntes: opcoes.kmAntes[v.id] ?? null, fatorFixos: opcoes.fatorFixos, rateio },
    );
  });
  const soma = (f: (r: ResultadoVeiculo) => number) => d2(somaDec(resultados.map(f)));
  const faturamento = soma((r) => r.faturamento);
  const lucro = soma((r) => r.lucro);
  const kmRodado = resultados.some((r) => r.km.rodado !== null) ? resultados.reduce((s, r) => s + (r.km.rodado ?? 0), 0) : null;
  const litros = soma((r) => r.litros);
  const custo = faturamento - lucro;
  const porGrupo = Object.fromEntries(Object.keys(GRUPOS_DESPESA).map((g) => [g, soma((r) => r.porGrupo[g as GrupoDespesa])])) as Record<GrupoDespesa, number>;
  const litrosMedia = resultados.reduce((s, r) => s + (r.mediaKmL && r.km.rodado ? r.km.rodado / r.mediaKmL : 0), 0);
  const kmComMedia = resultados.reduce((s, r) => s + (r.mediaKmL && r.km.rodado ? r.km.rodado : 0), 0);
  return {
    veiculos: resultados.sort((a, b) => b.lucro - a.lucro),
    fatorFixos: opcoes.fatorFixos,
    total: {
      viagens: viagens.length,
      faturamento,
      deducoes: {
        icms: soma((r) => r.deducoes.icms),
        quebra: soma((r) => r.deducoes.quebra),
        outras: soma((r) => r.deducoes.outras),
        total: soma((r) => r.deducoes.total),
      },
      comissao: soma((r) => r.comissao),
      porGrupo,
      despesasVariaveis: soma((r) => r.despesasVariaveis),
      sobraViagens: soma((r) => r.sobraViagens),
      fixos: {
        motorista: soma((r) => r.fixos.motorista),
        depreciacao: soma((r) => r.fixos.depreciacao),
        financiamento: soma((r) => r.fixos.financiamento),
        seguro: soma((r) => r.fixos.seguro),
        outros: soma((r) => r.fixos.outros),
        total: soma((r) => r.fixos.total),
      },
      rateio: soma((r) => r.rateio),
      lucro,
      margem: faturamento > 0 ? Math.round((lucro / faturamento) * 1000) / 10 : null,
      km: { inicial: null, final: null, rodado: kmRodado },
      litros,
      mediaKmL: litrosMedia > 0 ? Math.round((kmComMedia / litrosMedia) * 100) / 100 : null,
      custoKm: kmRodado ? Math.round((custo / kmRodado) * 100) / 100 : null,
      receitaKm: kmRodado ? Math.round((faturamento / kmRodado) * 100) / 100 : null,
      lucroKm: kmRodado ? Math.round((lucro / kmRodado) * 100) / 100 : null,
    },
  };
}

/** Composição de cada R$ 100 de faturamento (fatias que somam 100; a última é o resultado líquido). */
export function cadaCem(r: Pick<ResultadoVeiculo, "faturamento" | "deducoes" | "comissao" | "porGrupo" | "despesasVariaveis" | "fixos" | "rateio" | "lucro">) {
  if (r.faturamento <= 0) return [];
  const pct = (v: number) => Math.round((v / r.faturamento) * 1000) / 10;
  const outras = r.despesasVariaveis - r.porGrupo.combustivel - r.porGrupo.arla;
  return [
    { chave: "combustivel", rotulo: "Combustível e Arla 32", valor: pct(r.porGrupo.combustivel + r.porGrupo.arla) },
    { chave: "motorista", rotulo: "Motorista (comissão, salário e encargos)", valor: pct(r.comissao + r.fixos.motorista) },
    { chave: "caminhao", rotulo: "Veículo (pneus, manutenção, pedágio, financiamento, seguro)", valor: pct(outras + r.fixos.total - r.fixos.motorista) },
    { chave: "impostos", rotulo: "Tributos e deduções do frete", valor: pct(r.deducoes.total) },
    { chave: "escritorio", rotulo: "Despesas administrativas (rateio)", valor: pct(r.rateio) },
    { chave: "lucro", rotulo: r.lucro >= 0 ? "Resultado líquido" : "Resultado líquido (negativo)", valor: pct(r.lucro) },
  ].filter((f) => f.valor !== 0);
}
