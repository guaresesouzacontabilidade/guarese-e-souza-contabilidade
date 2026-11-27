import { MODELO_POR_CHAVE, limiteSemanal, limitesDiarios } from "./modelos";
import { MAX_DIAS_SEGUIDOS, domingosPermitidos } from "./gerador";
import { duracaoBruta, duracaoTrabalho, formatarHoras, minutos, minutosNoturnos } from "./horas";
import { type ConfigEscala, type Grade, type Historico, type Pessoa, type Turno, DIAS_CURTOS, diaAbsoluto, diasDoMes, ehTurno, isoData } from "./tipos";

/**
 * Conferência da escala com as regras da CLT. Não substitui a análise da
 * convenção coletiva da categoria: aponta o que, pela lei, precisa de ajuste
 * ("erro"), de documento ou atenção ("alerta") ou só de registro ("info").
 */

export type Gravidade = "erro" | "alerta" | "info";

export interface Achado {
  gravidade: Gravidade;
  regra:
    | "grade"
    | "intervalo"
    | "jornada_diaria"
    | "jornada_semanal"
    | "interjornada"
    | "repouso"
    | "domingo"
    | "feriado"
    | "noturno"
    | "restricao"
    | "cobertura"
    | "modelo";
  titulo: string;
  detalhe: string;
  pessoaId?: string;
  /** Dia do mês (1 a 31). */
  dia?: number;
  base?: string;
}

export interface ResumoPessoa {
  pessoaId: string;
  diasTrabalhados: number;
  folgas: number;
  ausencias: number;
  minutosMes: number;
  minutosNoturnos: number;
  domingosFolga: number;
  semanas: { inicio: number; fim: number; minutos: number }[];
}

export interface CoberturaDia {
  dia: number;
  turno: string;
  escalados: number;
  minimo: number;
}

export interface ResultadoConferencia {
  achados: Achado[];
  resumo: ResumoPessoa[];
  cobertura: CoberturaDia[];
  erros: number;
  alertas: number;
}

const dataBr = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const diaDescr = (d: Date) => `${DIAS_CURTOS[d.getUTCDay()]} ${dataBr(d)}`;

/** Confere os turnos cadastrados (intervalo do art. 71). */
function conferirTurnos(config: ConfigEscala, usados: Set<string>): Achado[] {
  const achados: Achado[] = [];
  const minimoLongo = config.regras.intervaloReduzido ? 30 : 60;
  const em12x36 = new Set(config.pessoas.filter((p) => p.modelo === "12x36" || p.modelo === "24x48").flatMap((p) => p.turnos));
  for (const t of config.turnos) {
    if (!usados.has(t.id)) continue;
    const trabalho = duracaoTrabalho(t);
    if (trabalho > 6 * 60 && t.intervaloMin < minimoLongo) {
      if (em12x36.has(t.id) && t.intervaloMin === 0) {
        achados.push({
          gravidade: "alerta",
          regra: "intervalo",
          titulo: `Turno ${t.nome}: sem intervalo`,
          detalhe: "Na 12x36 o intervalo pode ser indenizado, mas isso precisa constar do acordo ou da convenção; sem isso, conceda 1 hora.",
          base: "CLT, art. 59-A",
        });
      } else {
        achados.push({
          gravidade: "erro",
          regra: "intervalo",
          titulo: `Turno ${t.nome}: intervalo de ${formatarHoras(t.intervaloMin)}`,
          detalhe: config.regras.intervaloReduzido
            ? "Mesmo com a convenção coletiva, o intervalo de quem trabalha mais de 6 horas é de no mínimo 30 minutos."
            : "Quem trabalha mais de 6 horas tem direito a no mínimo 1 hora de intervalo (30 minutos só com convenção ou acordo coletivo).",
          base: config.regras.intervaloReduzido ? "CLT, art. 611-A, III" : "CLT, art. 71",
        });
      }
    } else if (trabalho > 4 * 60 && trabalho <= 6 * 60 && t.intervaloMin < 15) {
      achados.push({
        gravidade: "erro",
        regra: "intervalo",
        titulo: `Turno ${t.nome}: intervalo de ${formatarHoras(t.intervaloMin)}`,
        detalhe: "Quem trabalha entre 4 e 6 horas tem direito a 15 minutos de intervalo.",
        base: "CLT, art. 71, § 1º",
      });
    }
    if (t.intervaloMin > 120 && !em12x36.has(t.id)) {
      achados.push({
        gravidade: "alerta",
        regra: "intervalo",
        titulo: `Turno ${t.nome}: intervalo de ${formatarHoras(t.intervaloMin)}`,
        detalhe: "Intervalo acima de 2 horas só com acordo escrito ou convenção coletiva.",
        base: "CLT, art. 71",
      });
    }
  }
  return achados;
}

/** Fim do turno em minutos a partir da meia-noite do dia em que começa. */
function fimAbsoluto(t: Turno) {
  return minutos(t.inicio) + duracaoBruta(t);
}

export function conferirEscala(config: ConfigEscala, competencia: string, grade: Grade, historico: Historico = {}): ResultadoConferencia {
  const dias = diasDoMes(competencia);
  const n = dias.length;
  const turnos = new Map(config.turnos.map((t) => [t.id, t]));
  const feriados = new Map(config.feriados.map((f) => [f.data, f.nome]));
  const achados: Achado[] = [];
  const resumo: ResumoPessoa[] = [];
  const usados = new Set<string>();
  const domingoAbre = config.funcionamento[0].aberto;

  for (const p of config.pessoas) {
    const m = MODELO_POR_CHAVE[p.modelo];
    const codigos = grade[p.id] ?? [];
    const nome = p.nome;
    const add = (a: Omit<Achado, "pessoaId">) => achados.push({ ...a, pessoaId: p.id });

    if (codigos.length !== n || codigos.some((c) => !(c === "F" || c === "FE" || c === "AF" || (ehTurno(c) && turnos.has(c))))) {
      add({ gravidade: "erro", regra: "grade", titulo: `${nome}: escala incompleta`, detalhe: "Há dias sem turno ou folga definidos. Gere a escala de novo ou preencha os dias." });
      continue;
    }
    for (const c of codigos) if (ehTurno(c)) usados.add(c);

    const { normal, maxima } = limitesDiarios(m, config.regras.revezamento8h);
    const semanal = limiteSemanal(m, config.regras.revezamento8h);
    const r: ResumoPessoa = { pessoaId: p.id, diasTrabalhados: 0, folgas: 0, ausencias: 0, minutosMes: 0, minutosNoturnos: 0, domingosFolga: 0, semanas: [] };

    // Histórico + mês, para continuar as contagens
    const h = historico[p.id] ?? [];
    const linha = [...h, ...codigos];
    const desloc = h.length;
    const dataDe = (j: number) => new Date((diaAbsoluto(dias[0]) - desloc + j) * 86_400_000);

    const turnosAvisados = new Set<string>();
    let feriadosTrabalhados = 0;
    let seguidos = 0;
    let domingosSeguidos = 0;
    const limiteDom = domingosPermitidos(config, p);
    for (let j = 0; j < linha.length; j++) {
      const c = linha[j];
      const d = dataDe(j);
      const noMes = j >= desloc;
      const dia = j - desloc + 1;
      const t = ehTurno(c) ? turnos.get(c) : undefined;

      if (noMes) {
        if (t) r.diasTrabalhados++;
        else if (c === "F") r.folgas++;
        else r.ausencias++;
      }

      // Repouso semanal: no máximo 6 dias seguidos
      if (t) {
        seguidos++;
        if (m.aplicaRepouso && seguidos === MAX_DIAS_SEGUIDOS + 1 && noMes) {
          add({
            gravidade: "erro",
            regra: "repouso",
            dia,
            titulo: `${nome}: 7º dia seguido de trabalho em ${diaDescr(d)}`,
            detalhe: "A folga semanal precisa vir até o 7º dia; dar a folga depois disso equivale a trabalhar no repouso (pagamento em dobro).",
            base: "Constituição, art. 7º, XV; CLT, art. 67; TST, OJ 410 da SDI-1",
          });
        }
      } else seguidos = 0;

      // Domingo de folga
      if (d.getUTCDay() === 0 && domingoAbre && m.aplicaRepouso) {
        if (t) {
          domingosSeguidos++;
          if (domingosSeguidos === limiteDom + 1 && noMes) {
            const quinzenal = p.domingoQuinzenal && limiteDom === 1;
            add({
              gravidade: "erro",
              regra: "domingo",
              dia,
              titulo: `${nome}: ${domingosSeguidos}º domingo seguido trabalhado (${dataBr(d)})`,
              detalhe: quinzenal
                ? "Para empregadas, o domingo de folga vem a cada 15 dias."
                : config.regras.domingoACadaSemanas === 3
                  ? "A folga precisa cair no domingo pelo menos 1 vez a cada 3 semanas."
                  : "A folga precisa cair no domingo pelo menos 1 vez a cada 7 semanas.",
              base: quinzenal
                ? "CLT, art. 386"
                : config.regras.domingoACadaSemanas === 3
                  ? "Lei 10.101/2000, art. 6º, parágrafo único"
                  : "Portaria MTP 671/2021 (atividades autorizadas a abrir aos domingos)",
            });
          }
        } else {
          domingosSeguidos = 0;
          if (noMes) r.domingosFolga++;
        }
      } else if (d.getUTCDay() === 0 && noMes && !t) r.domingosFolga++;

      if (!noMes || !t) continue;

      // Jornada do dia
      const trabalho = duracaoTrabalho(t);
      r.minutosMes += trabalho;
      const noturno = minutosNoturnos(t);
      r.minutosNoturnos += noturno;
      if (!turnosAvisados.has(t.id)) {
        turnosAvisados.add(t.id);
        if (trabalho > maxima) {
          add({
            gravidade: "erro",
            regra: "jornada_diaria",
            titulo: `${nome}: ${formatarHoras(trabalho)} por dia no turno ${t.nome}`,
            detalhe: `No modelo ${m.nome}, o máximo é ${formatarHoras(maxima)} por dia.`,
            base: m.chave === "revezamento" ? "Constituição, art. 7º, XIV; TST, Súmula 423" : "CLT, arts. 59 e 59-A",
          });
        } else if (trabalho > normal) {
          add({
            gravidade: "alerta",
            regra: "jornada_diaria",
            titulo: `${nome}: ${formatarHoras(trabalho)} por dia no turno ${t.nome}`,
            detalhe: "Acima de 8 horas por dia só com acordo de compensação de jornada (ou como hora extra, até 2 horas).",
            base: "CLT, art. 59, §§ 2º e 6º",
          });
        }
        if (p.menorIdade && trabalho > 8 * 60) {
          add({ gravidade: "erro", regra: "jornada_diaria", titulo: `${nome}: menor de idade com ${formatarHoras(trabalho)} por dia`, detalhe: "O menor de 18 anos não faz hora extra; compensação só com convenção coletiva.", base: "CLT, art. 413" });
        }
        if (noturno > 0 && p.menorIdade) {
          add({ gravidade: "erro", regra: "noturno", titulo: `${nome}: menor de idade em horário noturno (turno ${t.nome})`, detalhe: "Menores de 18 anos não podem trabalhar entre 22h e 5h.", base: "CLT, art. 404; Constituição, art. 7º, XXXIII" });
        }
      }

      // Restrição da pessoa
      if (p.naoTrabalha.includes(d.getUTCDay())) {
        add({ gravidade: "alerta", regra: "restricao", dia, titulo: `${nome}: escalada em ${diaDescr(d)}`, detalhe: "A pessoa está cadastrada como “não trabalha” neste dia da semana." });
      }

      // Feriado trabalhado
      const feriado = feriados.get(isoData(d));
      if (feriado) feriadosTrabalhados++;
      if (feriado && !m.feriadosCompensados) {
        const comercio = config.regras.atividade === "comercio";
        add({
          gravidade: comercio ? "alerta" : "info",
          regra: "feriado",
          dia,
          titulo: `${nome}: trabalha no feriado de ${dataBr(d)} (${feriado})`,
          detalhe: comercio
            ? "No comércio, abrir no feriado depende de convenção coletiva. Pague o dia em dobro ou dê outra folga."
            : "Pague o dia em dobro ou dê outra folga na semana.",
          base: comercio ? "Lei 10.101/2000, art. 6º-A; Lei 605/1949, art. 9º" : "Lei 605/1949, art. 9º; TST, Súmula 146",
        });
      }

      // Descanso entre jornadas (11 horas), olhando o próximo dia de trabalho
      const prox = linha[j + 1];
      const tp = ehTurno(prox) ? turnos.get(prox) : undefined;
      if (tp && j + 1 < linha.length) {
        const descanso = 1440 + minutos(tp.inicio) - fimAbsoluto(t);
        if (descanso < 11 * 60) {
          add({
            gravidade: "erro",
            regra: "interjornada",
            dia: dia + 1 <= n ? dia + 1 : dia,
            titulo: `${nome}: só ${formatarHoras(Math.max(0, descanso))} de descanso antes de ${diaDescr(dataDe(j + 1))}`,
            detalhe: "Entre o fim de uma jornada e o começo da outra, o descanso mínimo é de 11 horas.",
            base: "CLT, art. 66",
          });
        }
      }
    }

    // Horas por semana (segunda a domingo; semanas parciais contam só os dias do mês)
    const recuo = (dias[0].getUTCDay() + 6) % 7;
    for (let ini = -recuo; ini < n; ini += 7) {
      let total = 0;
      for (let i = Math.max(0, ini); i < Math.min(n, ini + 7); i++) {
        const t = ehTurno(codigos[i]) ? turnos.get(codigos[i]) : undefined;
        if (t) total += duracaoTrabalho(t);
      }
      // completa com o histórico na primeira semana
      if (ini < 0) {
        for (let i = ini; i < 0; i++) {
          const c = h[h.length + i];
          const t = ehTurno(c) ? turnos.get(c) : undefined;
          if (t) total += duracaoTrabalho(t);
        }
      }
      const semana = { inicio: Math.max(0, ini) + 1, fim: Math.min(n, ini + 7), minutos: total };
      r.semanas.push(semana);
      if (semanal !== null && total > semanal) {
        add({
          gravidade: "erro",
          regra: "jornada_semanal",
          dia: semana.inicio,
          titulo: `${nome}: ${formatarHoras(total)} na semana de ${String(semana.inicio).padStart(2, "0")} a ${String(semana.fim).padStart(2, "0")}`,
          detalhe:
            m.chave === "parcial"
              ? "No regime de tempo parcial, o limite é de 30 horas por semana."
              : `O limite no modelo ${m.nome} é de ${formatarHoras(semanal)} por semana.`,
          base: m.chave === "parcial" ? "CLT, art. 58-A" : "Constituição, art. 7º, XIII",
        });
      } else if (semanal !== null && total > p.jornadaSemanal * 60 + 0.5) {
        add({
          gravidade: "alerta",
          regra: "jornada_semanal",
          dia: semana.inicio,
          titulo: `${nome}: ${formatarHoras(total)} na semana de ${String(semana.inicio).padStart(2, "0")} a ${String(semana.fim).padStart(2, "0")}`,
          detalhe: `O contrato é de ${formatarHoras(p.jornadaSemanal * 60)} por semana: a diferença é hora extra (adicional de no mínimo 50%).`,
          base: "Constituição, art. 7º, XVI",
        });
      }
    }

    if (r.minutosNoturnos > 0 && !p.menorIdade) {
      add({
        gravidade: "info",
        regra: "noturno",
        titulo: `${nome}: ${formatarHoras(r.minutosNoturnos)} entre 22h e 5h no mês`,
        detalhe: "A hora noturna conta como 52 minutos e 30 segundos e tem adicional de no mínimo 20%.",
        base: "CLT, art. 73",
      });
    }
    if (m.feriadosCompensados && feriadosTrabalhados > 0) {
      add({
        gravidade: "info",
        regra: "feriado",
        titulo: `${nome}: ${feriadosTrabalhados} feriado(s) no plantão`,
        detalhe: "Na 12x36, o feriado trabalhado já é considerado compensado pela escala.",
        base: "CLT, art. 59-A, parágrafo único",
      });
    }
    resumo.push(r);
  }

  // Exigências de cada modelo usado (uma vez por modelo)
  const modelosUsados = new Set(config.pessoas.map((p) => p.modelo));
  for (const chave of modelosUsados) {
    const m = MODELO_POR_CHAVE[chave];
    for (const e of m.exige) {
      const precisa =
        (chave !== "5x2" && chave !== "4x3" && chave !== "revezamento") ||
        config.pessoas.some((p) => p.modelo === chave && p.turnos.some((t) => turnos.has(t) && duracaoTrabalho(turnos.get(t)!) > 8 * 60)) ||
        (chave === "revezamento" && config.regras.revezamento8h);
      if (precisa) achados.push({ gravidade: m.risco === "alto" ? "alerta" : "info", regra: "modelo", titulo: `Escala ${m.nome}`, detalhe: e });
    }
    if (m.risco === "alto") for (const a of m.atencao) achados.push({ gravidade: "alerta", regra: "modelo", titulo: `Escala ${m.nome}`, detalhe: a });
  }

  achados.push(...conferirTurnos(config, usados));

  // Cobertura mínima por turno e dia
  const cobertura: CoberturaDia[] = [];
  for (const k of config.cobertura) {
    const t = turnos.get(k.turno);
    if (!t) continue;
    for (let i = 0; i < n; i++) {
      const dow = dias[i].getUTCDay();
      const minimo = k.minimo[dow] ?? 0;
      const fechado = !config.funcionamento[dow].aberto || (!config.regras.trabalhaFeriados && feriados.has(isoData(dias[i])));
      const escalados = config.pessoas.filter((p) => grade[p.id]?.[i] === k.turno).length;
      cobertura.push({ dia: i + 1, turno: k.turno, escalados, minimo: fechado ? 0 : minimo });
      if (!fechado && escalados < minimo) {
        achados.push({
          gravidade: "alerta",
          regra: "cobertura",
          dia: i + 1,
          titulo: `Falta${minimo - escalados > 1 ? "m" : ""} ${minimo - escalados} no turno ${t.nome} em ${diaDescr(dias[i])}`,
          detalhe: `${escalados} de ${minimo} pessoas escaladas.`,
        });
      }
    }
  }

  const ordem: Record<Gravidade, number> = { erro: 0, alerta: 1, info: 2 };
  achados.sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade] || (a.dia ?? 0) - (b.dia ?? 0));
  return {
    achados,
    resumo,
    cobertura,
    erros: achados.filter((a) => a.gravidade === "erro").length,
    alertas: achados.filter((a) => a.gravidade === "alerta").length,
  };
}

/** Pessoa por id (atalho para as telas). */
export function pessoaPorId(config: ConfigEscala, id: string): Pessoa | undefined {
  return config.pessoas.find((p) => p.id === id);
}
