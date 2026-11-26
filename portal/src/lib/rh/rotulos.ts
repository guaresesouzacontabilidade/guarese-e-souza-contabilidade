/**
 * Gestão de RH: nomes, cores e textos das tarefas recorrentes (sem acesso ao
 * banco; usado no servidor e no navegador).
 */

export type Periodicidade = "diaria" | "semanal" | "quinzenal" | "mensal";
export type StatusTarefa = "a_fazer" | "em_andamento" | "concluida";
export type RegraTarefa =
  | "manual"
  | "envio_extrato"
  | "fechamento_caixa"
  | "conciliacao_semanal"
  | "conferencia_estoque";

/** Etiqueta de cada periodicidade: texto e cor diferentes (não depende só da cor). */
export const PERIODICIDADE: Record<
  Periodicidade,
  { rotulo: string; classe: string }
> = {
  diaria: {
    rotulo: "Diária",
    classe:
      "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100",
  },
  semanal: {
    rotulo: "Semanal",
    classe:
      "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  },
  quinzenal: {
    rotulo: "Quinzenal",
    classe:
      "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100",
  },
  mensal: {
    rotulo: "Mensal",
    classe:
      "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100",
  },
};

export const PERIODICIDADES = Object.keys(PERIODICIDADE) as Periodicidade[];

export const STATUS: Record<StatusTarefa, { rotulo: string }> = {
  a_fazer: { rotulo: "A fazer" },
  em_andamento: { rotulo: "Em andamento" },
  concluida: { rotulo: "Concluída" },
};

export const COLUNAS: StatusTarefa[] = ["a_fazer", "em_andamento", "concluida"];

export const REGRA: Record<
  RegraTarefa,
  { rotulo: string; ajuda: string; automatica: boolean }
> = {
  manual: {
    rotulo: "Manual",
    ajuda: "Quem faz conclui no quadro (com as exigências marcadas).",
    automatica: false,
  },
  envio_extrato: {
    rotulo: "Envio do extrato (manual)",
    ajuda:
      "Quem enviou confirma a semana de referência; dá para ligar o extrato enviado pelo portal.",
    automatica: false,
  },
  fechamento_caixa: {
    rotulo: "Automática: fechamento do caixa",
    ajuda: "Conclui sozinha quando o caixa do dia é fechado no portal.",
    automatica: true,
  },
  conciliacao_semanal: {
    rotulo: "Automática: conciliação da semana",
    ajuda:
      "Conclui sozinha quando todos os movimentos do extrato da semana estão conciliados.",
    automatica: true,
  },
  conferencia_estoque: {
    rotulo: "Botão Confirmar conferência",
    ajuda:
      "Conclui quando alguém clica em Confirmar conferência (registra quem e quando).",
    automatica: true,
  },
};

export const DIAS_SEMANA: Record<number, { curto: string; longo: string }> = {
  1: { curto: "Seg", longo: "segunda" },
  2: { curto: "Ter", longo: "terça" },
  3: { curto: "Qua", longo: "quarta" },
  4: { curto: "Qui", longo: "quinta" },
  5: { curto: "Sex", longo: "sexta" },
  6: { curto: "Sáb", longo: "sábado" },
  7: { curto: "Dom", longo: "domingo" },
};

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "AAAA-MM-DD" → "DD/MM" ou "DD/MM/AAAA". */
export function dataCurta(iso: string, comAno = false) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return comAno ? `${d}/${m}/${a}` : `${d}/${m}`;
}

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana da data ("AAAA-MM-DD"). */
export function segundaDaSemana(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const dia = d.getUTCDay() || 7;
  return somarDias(iso, 1 - dia);
}

/** Período da ocorrência em palavras ("Semana de 23/11 a 29/11", "1ª quinzena de novembro"...). */
export function rotuloPeriodo(
  periodicidade: Periodicidade,
  inicio: string,
  fim: string,
) {
  const [a, m, d] = inicio.split("-").map(Number);
  switch (periodicidade) {
    case "diaria":
      return dataCurta(inicio, true);
    case "semanal":
      return `Semana de ${dataCurta(inicio)} a ${dataCurta(fim, true)}`;
    case "quinzenal":
      return `${d <= 15 ? "1ª" : "2ª"} quinzena de ${MESES[m - 1]} de ${a}`;
    case "mensal":
      return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} de ${a}`;
  }
}

/** Calendário do modelo em palavras ("Toda sexta até 18:00", "Seg a sáb até 19:00"...). */
export function descreverCalendario(m: {
  periodicidade: Periodicidade;
  dias_semana: number[];
  dia_semana: number;
  dia_mes: number;
  hora_limite: string;
}) {
  const hora = m.hora_limite.slice(0, 5);
  switch (m.periodicidade) {
    case "diaria": {
      const dias = [...m.dias_semana].sort((x, y) => x - y);
      const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
      const texto =
        dias.length === 7
          ? "Todo dia"
          : seguidos && dias.length > 2
            ? `${DIAS_SEMANA[dias[0]].curto} a ${DIAS_SEMANA[dias[dias.length - 1]].curto.toLowerCase()}`
            : dias.map((d) => DIAS_SEMANA[d].curto).join(", ");
      return `${texto} até ${hora}`;
    }
    case "semanal":
      return `Toda ${DIAS_SEMANA[m.dia_semana].longo}${m.dia_semana >= 6 ? "" : "-feira"} até ${hora}`
        .replace("Toda sábado", "Todo sábado")
        .replace("Toda domingo", "Todo domingo");
    case "quinzenal":
      return `Até o último dia de cada quinzena, ${hora}`;
    case "mensal":
      return `${m.dia_mes >= 28 ? "Até o fim do mês" : `Todo dia ${m.dia_mes}`} até ${hora}`;
  }
}

/** Prazo passou e a tarefa não foi concluída. */
export function atrasada(
  t: { status: StatusTarefa; prazo: string },
  agora = Date.now(),
) {
  return t.status !== "concluida" && new Date(t.prazo).getTime() < agora;
}

/** "26/11 18:00" no fuso do escritório. */
export function formatarPrazo(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Araguaina",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", "");
}

/** "26/11/2026 às 18:00" no fuso do escritório. */
export function formatarDataHoraRh(iso: string) {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Araguaina",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const p = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} às ${p("hour")}:${p("minute")}`;
}

/** Semanas (segunda) para escolher a semana de referência: a da tarefa e as vizinhas. */
export function semanasProximas(iso: string, antes = 2, depois = 1) {
  const base = segundaDaSemana(iso);
  const lista: { valor: string; rotulo: string }[] = [];
  for (let i = -antes; i <= depois; i++) {
    const s = somarDias(base, i * 7);
    lista.push({
      valor: s,
      rotulo: `${dataCurta(s)} a ${dataCurta(somarDias(s, 6), true)}`,
    });
  }
  return lista;
}

/** Ordem entre dois cartões vizinhos (para soltar no meio da coluna). */
export function ordemEntre(anterior: number | null, seguinte: number | null) {
  if (anterior === null && seguinte === null) return Date.now() / 1000;
  if (anterior === null) return (seguinte as number) - 1;
  if (seguinte === null) return anterior + 1;
  return (anterior + seguinte) / 2;
}
