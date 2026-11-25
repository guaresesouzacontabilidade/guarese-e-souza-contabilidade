/**
 * Relatório de desempenho das ordens de serviço (contas puras, testadas).
 *
 * - "Concluída" = ficou pronta no período (os tempos médios e a comparação com
 *   o estimado usam só essas).
 * - O tempo real de cada serviço sai da comparação entre as OS: o portal
 *   procura o fator de cada serviço (real ÷ estimado) que melhor explica o
 *   tempo de execução de todas as OS concluídas (mínimos quadrados, puxando
 *   para 1 quando há poucos dados). Com poucas OS, divide o tempo de cada OS
 *   entre os serviços na proporção do estimado.
 * - A sugestão de estimativa aparece com 3 OS ou mais e desvio acima de 20%.
 */
import { entregaPrevista } from "./rotulos";

export interface OrdemRelatorio {
  id: string;
  numero: number;
  cliente_nome: string;
  etapa: string;
  prioridade: string;
  responsavel_id: string | null;
  prazo: string | null;
  previsao: string | null;
  minutos_estimados: number | string;
  minutos_execucao: number | string;
  minutos_pausa: number | string;
  valor_total: number | string;
  aberta_em: string;
  iniciada_em: string | null;
  pronta_em: string | null;
  entregue_em: string | null;
  cancelada_em: string | null;
}

export interface ItemRelatorio {
  ordem_id: string;
  servico_id: string | null;
  descricao: string;
  quantidade: number | string;
  unidade: string;
  minutos_estimados: number | string;
}

export interface ServicoRelatorio {
  id: string;
  nome: string;
  unidade: string;
  minutos_por_unidade: number | string;
  minutos_fixos: number | string;
}

export interface LinhaServico {
  chave: string;
  nome: string;
  unidade: string;
  ordens: number;
  quantidade: number;
  minutosEstimados: number;
  minutosReais: number;
  desvioPercentual: number | null;
  estimadoPorUnidade: number | null;
  realPorUnidade: number | null;
  sugestaoPorUnidade: number | null;
}

export interface LinhaResponsavel {
  id: string | null;
  nome: string;
  concluidas: number;
  minutosExecucao: number;
  mediaExecucao: number;
  minutosEstimados: number;
  noPrazo: number;
  comPrazo: number;
}

export interface Relatorio {
  abertas: number;
  concluidas: number;
  entregues: number;
  canceladas: number;
  valorConcluido: number;
  mediaFila: number | null;
  mediaExecucao: number | null;
  mediaPausa: number | null;
  mediaAguardandoRetirada: number | null;
  mediaTotal: number | null;
  estimadoTotal: number;
  realTotal: number;
  desvioPercentual: number | null;
  comPrazo: number;
  noPrazo: number;
  percentualNoPrazo: number | null;
  porServico: LinhaServico[];
  porResponsavel: LinhaResponsavel[];
  porDia: { dia: string; abertas: number; concluidas: number }[];
  concluidasLista: OrdemRelatorio[];
}

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const minutos = (de: string | null, ate: string | null) => (de && ate ? Math.max((new Date(ate).getTime() - new Date(de).getTime()) / 60000, 0) : null);
const media = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Dia (AAAA-MM-DD) no horário de Brasília/Tocantins. */
export function diaLocal(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

const noPeriodo = (ts: string | null, inicio: string, fim: string) => {
  if (!ts) return false;
  const d = diaLocal(ts);
  return d >= inicio && d <= fim;
};

/** Resolve A·x = b (Gauss com pivô); null se não tiver solução estável. */
function resolver(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-9) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((l, i) => l[n] / l[i]);
}

/**
 * Fator real ÷ estimado de cada serviço, pelo conjunto das OS: minimiza
 * Σ (real da OS − Σ fator × estimado do serviço)², com um puxão para 1 que
 * evita conclusões com poucos dados. Fatores entre 0,1 e 10.
 */
export function fatoresPorServico(ordens: { real: number; estimados: Map<string, number> }[]): Map<string, number> | null {
  const chaves = [...new Set(ordens.flatMap((o) => [...o.estimados.keys()]))];
  const k = chaves.length;
  if (!k || ordens.length < Math.max(3, k)) return null;
  const idx = new Map(chaves.map((c, i) => [c, i]));
  const A = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const b = Array<number>(k).fill(0);
  for (const o of ordens) {
    const x = Array<number>(k).fill(0);
    for (const [c, v] of o.estimados) x[idx.get(c)!] += v;
    for (let i = 0; i < k; i++) {
      if (!x[i]) continue;
      b[i] += x[i] * o.real;
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
    }
  }
  const media = A.reduce((s, l, i) => s + l[i], 0) / k;
  const lambda = 0.02 * media;
  for (let i = 0; i < k; i++) {
    A[i][i] += lambda;
    b[i] += lambda;
  }
  const x = resolver(A, b);
  if (!x || x.some((v) => !Number.isFinite(v))) return null;
  return new Map(chaves.map((c, i) => [c, Math.min(Math.max(x[i], 0.1), 10)]));
}

export function montarRelatorio(
  dados: { ordens: OrdemRelatorio[]; itens: ItemRelatorio[]; servicos: ServicoRelatorio[]; equipe: { id: string; nome: string }[] },
  inicio: string,
  fim: string,
): Relatorio {
  const { ordens, itens, servicos, equipe } = dados;
  const abertas = ordens.filter((o) => noPeriodo(o.aberta_em, inicio, fim));
  const concluidas = ordens.filter((o) => (o.etapa === "pronta" || o.etapa === "entregue") && noPeriodo(o.pronta_em, inicio, fim));
  const entregues = ordens.filter((o) => o.etapa === "entregue" && noPeriodo(o.entregue_em, inicio, fim));
  const canceladas = ordens.filter((o) => o.etapa === "cancelada" && noPeriodo(o.cancelada_em, inicio, fim));

  const estimadoTotal = concluidas.reduce((s, o) => s + num(o.minutos_estimados), 0);
  const realTotal = concluidas.reduce((s, o) => s + num(o.minutos_execucao), 0);
  const comPrazoLista = concluidas.filter((o) => entregaPrevista(o));
  const noPrazo = comPrazoLista.filter((o) => new Date(o.pronta_em!).getTime() <= new Date(entregaPrevista(o)!).getTime()).length;

  // Serviços: tempo real dividido na proporção do estimado de cada item
  const idsConcluidas = new Set(concluidas.map((o) => o.id));
  const porOrdem = new Map<string, ItemRelatorio[]>();
  for (const i of itens) {
    if (!idsConcluidas.has(i.ordem_id)) continue;
    porOrdem.set(i.ordem_id, [...(porOrdem.get(i.ordem_id) ?? []), i]);
  }
  const catalogo = new Map(servicos.map((s) => [s.id, s]));
  const chaveDe = (i: ItemRelatorio) => i.servico_id ?? `avulso:${i.descricao.trim().toLowerCase()}`;
  const fatores = fatoresPorServico(
    concluidas
      .filter((o) => (porOrdem.get(o.id) ?? []).some((i) => num(i.minutos_estimados) > 0))
      .map((o) => {
        const estimados = new Map<string, number>();
        for (const i of porOrdem.get(o.id) ?? []) estimados.set(chaveDe(i), (estimados.get(chaveDe(i)) ?? 0) + num(i.minutos_estimados));
        return { real: num(o.minutos_execucao), estimados };
      }),
  );
  const linhas = new Map<string, LinhaServico & { _ordens: Set<string> }>();
  for (const o of concluidas) {
    const lista = porOrdem.get(o.id) ?? [];
    const somaEst = lista.reduce((s, i) => s + num(i.minutos_estimados), 0);
    for (const i of lista) {
      const peso = somaEst > 0 ? num(i.minutos_estimados) / somaEst : 1 / lista.length;
      const s = i.servico_id ? catalogo.get(i.servico_id) : undefined;
      const chave = chaveDe(i);
      const l = linhas.get(chave) ?? {
        chave,
        nome: s?.nome ?? `${i.descricao} (avulso)`,
        unidade: s?.unidade ?? i.unidade,
        ordens: 0,
        quantidade: 0,
        minutosEstimados: 0,
        minutosReais: 0,
        desvioPercentual: null,
        estimadoPorUnidade: s ? num(s.minutos_por_unidade) : null,
        realPorUnidade: null,
        sugestaoPorUnidade: null,
        _ordens: new Set<string>(),
      };
      l._ordens.add(o.id);
      l.quantidade += num(i.quantidade);
      l.minutosEstimados += num(i.minutos_estimados);
      // Com os fatores: estimado × fator do serviço; sem eles, a parte proporcional do tempo da OS
      l.minutosReais += fatores?.has(chave) && num(i.minutos_estimados) > 0 ? num(i.minutos_estimados) * fatores.get(chave)! : num(o.minutos_execucao) * peso;
      linhas.set(chave, l);
    }
  }
  const porServico: LinhaServico[] = [...linhas.values()]
    .map(({ _ordens, ...l }) => {
      const ordensN = _ordens.size;
      const desvio = l.minutosEstimados > 0 ? ((l.minutosReais - l.minutosEstimados) / l.minutosEstimados) * 100 : null;
      const s = l.chave.startsWith("avulso:") ? undefined : catalogo.get(l.chave);
      const realPorUnidade = l.quantidade > 0 ? Math.max(l.minutosReais - (s ? num(s.minutos_fixos) * ordensN : 0), 0) / l.quantidade : null;
      const sugestao = realPorUnidade === null ? null : Math.max(Math.round(realPorUnidade * 2) / 2, 0.5);
      const sugerir = s && ordensN >= 3 && desvio !== null && Math.abs(desvio) > 20 && sugestao !== null && sugestao !== num(s.minutos_por_unidade);
      return {
        ...l,
        ordens: ordensN,
        minutosEstimados: r1(l.minutosEstimados),
        minutosReais: r1(l.minutosReais),
        desvioPercentual: desvio === null ? null : Math.round(desvio),
        realPorUnidade: realPorUnidade === null ? null : Math.round(realPorUnidade * 100) / 100,
        sugestaoPorUnidade: sugerir ? sugestao : null,
      };
    })
    .sort((a, b) => b.minutosReais - a.minutosReais);

  // Equipe
  const nomes = new Map(equipe.map((e) => [e.id, e.nome]));
  const resp = new Map<string, LinhaResponsavel>();
  for (const o of concluidas) {
    const chave = o.responsavel_id ?? "";
    const l = resp.get(chave) ?? {
      id: o.responsavel_id,
      nome: o.responsavel_id ? (nomes.get(o.responsavel_id) ?? "—") : "Sem responsável",
      concluidas: 0,
      minutosExecucao: 0,
      mediaExecucao: 0,
      minutosEstimados: 0,
      noPrazo: 0,
      comPrazo: 0,
    };
    l.concluidas += 1;
    l.minutosExecucao += num(o.minutos_execucao);
    l.minutosEstimados += num(o.minutos_estimados);
    const limite = entregaPrevista(o);
    if (limite) {
      l.comPrazo += 1;
      if (new Date(o.pronta_em!).getTime() <= new Date(limite).getTime()) l.noPrazo += 1;
    }
    resp.set(chave, l);
  }
  const porResponsavel = [...resp.values()]
    .map((l) => ({ ...l, minutosExecucao: r1(l.minutosExecucao), minutosEstimados: r1(l.minutosEstimados), mediaExecucao: r1(l.minutosExecucao / l.concluidas) }))
    .sort((a, b) => b.concluidas - a.concluidas);

  // Por dia (todos os dias do período, até 92)
  const dias: { dia: string; abertas: number; concluidas: number }[] = [];
  for (let d = new Date(`${inicio}T12:00:00Z`), i = 0; diaLocal(d.toISOString()) <= fim && i < 92; d = new Date(d.getTime() + 86400000), i++) {
    dias.push({ dia: diaLocal(d.toISOString()), abertas: 0, concluidas: 0 });
  }
  const idx = new Map(dias.map((x, i) => [x.dia, i]));
  for (const o of abertas) {
    const i = idx.get(diaLocal(o.aberta_em));
    if (i !== undefined) dias[i].abertas += 1;
  }
  for (const o of concluidas) {
    const i = idx.get(diaLocal(o.pronta_em!));
    if (i !== undefined) dias[i].concluidas += 1;
  }

  return {
    abertas: abertas.length,
    concluidas: concluidas.length,
    entregues: entregues.length,
    canceladas: canceladas.length,
    valorConcluido: Math.round(concluidas.reduce((s, o) => s + num(o.valor_total), 0) * 100) / 100,
    mediaFila: media(concluidas.map((o) => minutos(o.aberta_em, o.iniciada_em))),
    mediaExecucao: media(concluidas.map((o) => num(o.minutos_execucao))),
    mediaPausa: media(concluidas.map((o) => num(o.minutos_pausa))),
    mediaAguardandoRetirada: media(entregues.map((o) => minutos(o.pronta_em, o.entregue_em))),
    mediaTotal: media(concluidas.map((o) => minutos(o.aberta_em, o.pronta_em))),
    estimadoTotal: r1(estimadoTotal),
    realTotal: r1(realTotal),
    desvioPercentual: estimadoTotal > 0 ? Math.round(((realTotal - estimadoTotal) / estimadoTotal) * 100) : null,
    comPrazo: comPrazoLista.length,
    noPrazo,
    percentualNoPrazo: comPrazoLista.length ? Math.round((noPrazo / comPrazoLista.length) * 100) : null,
    porServico,
    porResponsavel,
    porDia: dias,
    concluidasLista: concluidas,
  };
}
