import { MODELO_POR_CHAVE, folgasNecessarias, tamanhoCiclo, type ModeloEscala } from "./modelos";
import { type ConfigEscala, type Grade, type Historico, type Pessoa, diaAbsoluto, diasDoMes, ehTurno, isoData } from "./tipos";

/**
 * Gerador da grade do mês. É determinístico (a mesma configuração gera a
 * mesma grade) e segue, pela ordem:
 *  1. dias em que a pessoa não pode trabalhar (empresa fechada, feriado com a
 *     empresa fechada, dia que a pessoa não trabalha, férias/afastamento já
 *     lançados);
 *  2. modelos de ciclo (12x36, 24x48, 5x1, 6x2): sequência fixa a partir da
 *     posição no ciclo, que continua de um mês para o outro;
 *  3. modelos semanais (5x2, 6x1, 4x3, revezamento, parcial, personalizada):
 *     semana a semana, o domingo de folga quando chega a vez, no máximo 6 dias
 *     seguidos de trabalho e as demais folgas nos dias com mais gente sobrando
 *     no turno (respeitando o mínimo de cada turno, as preferências e as
 *     folgas seguidas do 5x2 e do 4x3).
 * A conferência (conferencia.ts) aponta o que ainda ficar fora das regras.
 */

export const MAX_DIAS_SEGUIDOS = 6;

interface Estado {
  /** Dias seguidos de trabalho até o dia anterior. */
  seguidos: number;
  /** Domingos seguidos trabalhados. */
  domingos: number;
  /** Turno atual no revezamento. */
  turnoIdx: number;
  ultimoFoiFolga: boolean;
  /** Dia da semana da última folga escolhida (para manter a folga no mesmo dia). */
  ultimaFolgaDow: number | null;
}

export interface OpcoesGerador {
  /** Últimos dias do mês anterior (posição final = véspera do dia 1). */
  historico?: Historico;
  /** Férias e afastamentos já lançados (códigos FE e AF são mantidos). */
  manter?: Grade;
}

/** Quantos domingos seguidos a pessoa pode trabalhar (antes do domingo de folga). */
export function domingosPermitidos(config: ConfigEscala, p: Pick<Pessoa, "domingoQuinzenal">) {
  const semanas = p.domingoQuinzenal ? Math.min(2, config.regras.domingoACadaSemanas) : config.regras.domingoACadaSemanas;
  return semanas - 1;
}

const trabalha = (c: string | undefined) => ehTurno(c);

function estadoInicial(config: ConfigEscala, p: Pessoa, inicioMes: Date, historico: string[] | undefined): Estado {
  const limite = domingosPermitidos(config, p);
  if (!historico?.length) {
    // Sem o mês anterior: espalha a vez do domingo entre as pessoas
    return { seguidos: 0, domingos: p.deslocamento % (limite + 1), turnoIdx: p.deslocamento % p.turnos.length, ultimoFoiFolga: true, ultimaFolgaDow: null };
  }
  let seguidos = 0;
  for (let i = historico.length - 1; i >= 0 && trabalha(historico[i]); i--) seguidos++;
  let domingos = 0;
  const base = diaAbsoluto(inicioMes) - historico.length;
  for (let i = historico.length - 1; i >= 0; i--) {
    const dow = (((base + i + 4) % 7) + 7) % 7; // 01/01/1970 foi quinta-feira
    if (dow !== 0) continue;
    if (!trabalha(historico[i])) break;
    domingos++;
  }
  const ultimoTurno = [...historico].reverse().find(trabalha);
  const idx = ultimoTurno ? Math.max(0, p.turnos.indexOf(ultimoTurno)) : 0;
  return { seguidos, domingos, turnoIdx: idx, ultimoFoiFolga: !trabalha(historico[historico.length - 1]), ultimaFolgaDow: null };
}

function folgaForcada(config: ConfigEscala, p: Pessoa, d: Date, feriados: Set<string>) {
  const dow = d.getUTCDay();
  if (!config.funcionamento[dow]?.aberto) return true;
  if (!config.regras.trabalhaFeriados && feriados.has(isoData(d))) return true;
  return p.naoTrabalha.includes(dow);
}

function minimoDoTurno(config: ConfigEscala, turno: string, dow: number) {
  return config.cobertura.find((c) => c.turno === turno)?.minimo[dow] ?? 0;
}

/** Espalha as posições no ciclo entre as pessoas de cada modelo (folgas em dias diferentes). */
export function distribuirDeslocamentos(pessoas: Pessoa[]): Pessoa[] {
  const contagem = new Map<string, number>();
  return pessoas.map((p) => {
    const chave = `${p.modelo}:${p.turnos.join(",")}`;
    const i = contagem.get(chave) ?? 0;
    contagem.set(chave, i + 1);
    return { ...p, deslocamento: i % 60 };
  });
}

export function gerarGrade(config: ConfigEscala, competencia: string, opcoes: OpcoesGerador = {}): Grade {
  const dias = diasDoMes(competencia);
  const n = dias.length;
  const inicioMes = dias[0];
  const feriados = new Set(config.feriados.map((f) => f.data));
  const grade: Grade = {};
  const estados = new Map<string, Estado>();
  for (const p of config.pessoas) estados.set(p.id, estadoInicial(config, p, inicioMes, opcoes.historico?.[p.id]));

  // Ausências lançadas (férias, afastamento) ficam onde estão
  const manter = (p: Pessoa, i: number) => {
    const c = opcoes.manter?.[p.id]?.[i];
    return c === "FE" || c === "AF" ? c : null;
  };

  // 1-2. Modelos de ciclo
  const ciclo = config.pessoas.filter((p) => MODELO_POR_CHAVE[p.modelo].tipo === "ciclo");
  for (const p of ciclo) {
    const m = MODELO_POR_CHAVE[p.modelo];
    const tam = tamanhoCiclo(m);
    const est = estados.get(p.id)!;
    const limite = domingosPermitidos(config, p);
    const codigos: string[] = [];
    for (let i = 0; i < n; i++) {
      const d = dias[i];
      const fixo = manter(p, i);
      let codigo: string;
      if (fixo) codigo = fixo;
      else {
        const pos = (((diaAbsoluto(d) + p.deslocamento) % tam) + tam) % tam;
        codigo = pos < m.ciclo!.trabalho && !folgaForcada(config, p, d, feriados) ? p.turnos[0] : "F";
      }
      // 5x1 e 6x2: folga extra no domingo quando chega a vez (o ciclo continua igual)
      if (m.aplicaRepouso && d.getUTCDay() === 0 && config.funcionamento[0].aberto) {
        if (trabalha(codigo) && est.domingos >= limite) codigo = "F";
        est.domingos = trabalha(codigo) ? est.domingos + 1 : 0;
      }
      codigos.push(codigo);
    }
    grade[p.id] = codigos;
  }

  // 3. Modelos semanais, semana a semana (segunda a domingo)
  const semanais = config.pessoas.filter((p) => MODELO_POR_CHAVE[p.modelo].tipo === "semanal");
  if (!semanais.length) return grade;
  for (const p of semanais) grade[p.id] = new Array<string>(n).fill("F");

  const recuo = (inicioMes.getUTCDay() + 6) % 7; // dias entre a segunda-feira e o dia 1
  const primeiraSegunda = diaAbsoluto(inicioMes) - recuo;
  const totalSemanas = Math.ceil((recuo + n) / 7);

  for (let w = 0; w < totalSemanas; w++) {
    // índice no mês de cada dia da semana (-1 = fora do mês)
    const idxMes = Array.from({ length: 7 }, (_, k) => {
      const i = w * 7 + k - recuo;
      return i >= 0 && i < n ? i : -1;
    });
    const dataDe = (k: number) => new Date((primeiraSegunda + w * 7 + k) * 86_400_000);
    const historicoDia = (p: Pessoa, k: number) => {
      if (idxMes[k] !== -1 || w * 7 + k >= recuo) return undefined;
      const h = opcoes.historico?.[p.id];
      if (!h?.length) return undefined;
      return h[h.length - (recuo - k)];
    };

    // Turno de cada pessoa nesta semana (revezamento: o atual) e cobertura inicial
    const turnoDaSemana = new Map<string, string>();
    for (const p of semanais) turnoDaSemana.set(p.id, p.turnos[estados.get(p.id)!.turnoIdx % p.turnos.length]);
    const cobertura = new Map<string, number[]>();
    const somar = (turno: string, k: number, v: number) => {
      if (!cobertura.has(turno)) cobertura.set(turno, new Array(7).fill(0));
      cobertura.get(turno)![k] += v;
    };
    for (const p of ciclo) for (let k = 0; k < 7; k++) if (idxMes[k] !== -1 && trabalha(grade[p.id][idxMes[k]])) somar(grade[p.id][idxMes[k]], k, 1);
    for (const p of semanais) {
      for (let k = 0; k < 7; k++) {
        const i = idxMes[k];
        if (i === -1 || manter(p, i) || folgaForcada(config, p, dataDe(k), feriados)) continue;
        somar(turnoDaSemana.get(p.id)!, k, 1);
      }
    }

    // A ordem gira a cada semana (ninguém fica sempre com a pior escolha)
    const ordem = semanais.map((_, i) => semanais[(i + w) % semanais.length]);
    for (const p of ordem) {
      const m = MODELO_POR_CHAVE[p.modelo];
      const est = estados.get(p.id)!;
      const turno = turnoDaSemana.get(p.id)!;
      // Plano: "T" trabalho livre, "X" folga, ou código já definido (histórico/ausência)
      const plano: string[] = [];
      const travado: boolean[] = [];
      for (let k = 0; k < 7; k++) {
        const h = historicoDia(p, k);
        const i = idxMes[k];
        const fixo = i !== -1 ? manter(p, i) : null;
        if (h !== undefined) {
          plano.push(trabalha(h) ? h : "X");
          travado.push(true);
        } else if (fixo) {
          plano.push("X");
          travado.push(true);
        } else if (i !== -1 && folgaForcada(config, p, dataDe(k), feriados)) {
          plano.push("X");
          travado.push(true);
        } else if (i === -1 && dataDe(k).getUTCDay() !== 0 && !config.funcionamento[dataDe(k).getUTCDay()].aberto) {
          plano.push("X");
          travado.push(true);
        } else if (i === -1 && p.naoTrabalha.includes(dataDe(k).getUTCDay())) {
          plano.push("X");
          travado.push(true);
        } else {
          plano.push("T");
          travado.push(false);
        }
      }
      const folga = (k: number) => plano[k] === "X";
      const livre = (k: number) => !travado[k] && plano[k] === "T";

      const limiteDom = domingosPermitidos(config, p);
      const domingoAbre = config.funcionamento[0].aberto;
      const vezDoDomingo = m.aplicaRepouso && domingoAbre && est.domingos >= limiteDom;
      if (vezDoDomingo && livre(6)) plano[6] = "X";

      const preferidos = new Set(p.folgasPreferidas);
      const diasTrabalho = new Set(p.diasTrabalho);
      const usaDiasEscolhidos = p.modelo === "parcial" || p.modelo === "personalizada";
      const nota = (k: number) => {
        const dow = dataDe(k).getUTCDay();
        const i = idxMes[k];
        const escalados = cobertura.get(turno)?.[k] ?? 0;
        const sobra = escalados - minimoDoTurno(config, turno, dow);
        let s = sobra >= 1 ? sobra * 2 : -20 + sobra;
        if (i === -1) s = 0; // fora do mês: não pesa na cobertura
        if (preferidos.has(dow)) s += 3;
        if (usaDiasEscolhidos) s += diasTrabalho.has(dow) ? -50 : 5;
        if (m.folgasSeguidas && ((k > 0 && folga(k - 1)) || (k < 6 && folga(k + 1)))) s += 2.5;
        if (est.ultimaFolgaDow === dow) s += 1.5;
        if (dow === (p.deslocamento % 6) + 1) s += 0.75;
        if (dow === 0 && !vezDoDomingo) s -= 0.5;
        return s;
      };
      const melhor = (candidatos: number[]) =>
        candidatos.reduce((a, b) => (nota(b) > nota(a) ? b : a), candidatos[0]);

      // No máximo 6 dias seguidos de trabalho (contando a semana anterior)
      let seguidos = est.seguidos;
      for (let k = 0; k < 7; k++) {
        if (folga(k)) {
          seguidos = 0;
          continue;
        }
        seguidos++;
        if (seguidos > MAX_DIAS_SEGUIDOS) {
          const janela = [];
          for (let j = Math.max(0, k - seguidos + 1); j <= k; j++) if (livre(j)) janela.push(j);
          if (!janela.length) continue;
          const j = melhor(janela);
          plano[j] = "X";
          seguidos = k - j;
        }
      }

      // Demais folgas da semana
      const necessarias = folgasNecessarias(m, p.diasTrabalho);
      let feitas = plano.filter((c) => c === "X").length;
      while (feitas < necessarias) {
        const candidatos = [...Array(7).keys()].filter(livre);
        if (!candidatos.length) break;
        plano[melhor(candidatos)] = "X";
        feitas++;
      }

      // Grava os dias do mês, troca o turno do revezamento depois de cada folga
      for (let k = 0; k < 7; k++) {
        const i = idxMes[k];
        const ehFolga = folga(k);
        if (!ehFolga) {
          if (est.ultimoFoiFolga && p.modelo === "revezamento" && w * 7 + k >= recuo) est.turnoIdx = (est.turnoIdx + 1) % p.turnos.length;
          est.ultimoFoiFolga = false;
        } else {
          est.ultimoFoiFolga = true;
        }
        const turnoDia = p.modelo === "revezamento" ? p.turnos[est.turnoIdx % p.turnos.length] : turno;
        if (i !== -1) {
          const fixo = manter(p, i);
          grade[p.id][i] = fixo ?? (ehFolga ? "F" : turnoDia);
          if (!travado[k] && ehFolga) cobertura.get(turno)![k]--;
        }
        if (ehFolga && !travado[k] && dataDe(k).getUTCDay() !== 0) est.ultimaFolgaDow = dataDe(k).getUTCDay();
      }

      // Contagens para a próxima semana
      let fim = 0;
      for (let k = 6; k >= 0 && !folga(k); k--) fim++;
      est.seguidos = fim === 7 ? est.seguidos + 7 : fim;
      if (domingoAbre && m.aplicaRepouso) est.domingos = folga(6) ? 0 : est.domingos + 1;
    }
  }
  return grade;
}

/** Últimos `dias` códigos de cada pessoa numa grade (para servir de histórico do mês seguinte). */
export function historicoDaGrade(grade: Grade, dias = 49): Historico {
  return Object.fromEntries(Object.entries(grade).map(([id, codigos]) => [id, codigos.slice(-dias)]));
}

/** Modelo da pessoa (atalho). */
export function modeloDe(p: Pick<Pessoa, "modelo">): ModeloEscala {
  return MODELO_POR_CHAVE[p.modelo];
}
