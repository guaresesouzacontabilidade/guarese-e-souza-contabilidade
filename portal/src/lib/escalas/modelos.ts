import type { ChaveModelo, Turno } from "./tipos";

/**
 * Modelos de escala usados no mercado de trabalho brasileiro, com a base
 * legal e os cuidados de cada um. Os limites aqui alimentam o gerador e a
 * conferência (src/lib/escalas/conferencia.ts).
 *
 * Fontes (conferidas em 11/2026):
 *  - Constituição, art. 7º, XIII (8h por dia e 44h por semana), XIV (turnos
 *    ininterruptos de revezamento de 6h) e XV (repouso semanal, de preferência
 *    aos domingos).
 *  - CLT: art. 58-A (tempo parcial), art. 59 (horas extras e compensação),
 *    art. 59-A (12x36), art. 66 (11h entre jornadas), art. 67 (repouso
 *    semanal), art. 71 (intervalo), art. 73 (trabalho noturno), art. 386
 *    (domingo quinzenal das empregadas), arts. 404 e 413 (menores).
 *  - Lei 605/1949 (repouso remunerado e feriados) e Lei 10.101/2000, art. 6º,
 *    parágrafo único (comércio: domingo de folga ao menos 1 vez a cada 3 semanas)
 *    e art. 6º-A (feriado no comércio depende de convenção coletiva).
 *  - TST: OJ 410 da SDI-1 (repouso depois do 7º dia seguido viola a
 *    Constituição) e Súmula 423 (revezamento de 8h por negociação coletiva).
 */

export interface BaseLegal {
  texto: string;
  url?: string;
}

export interface ModeloEscala {
  chave: ChaveModelo;
  nome: string;
  resumo: string;
  comoFunciona: string;
  jornadaTipica: string;
  /** "semanal": folgas escolhidas a cada semana; "ciclo": sequência fixa de dias de trabalho e de folga. */
  tipo: "semanal" | "ciclo";
  ciclo?: { trabalho: number; folga: number };
  /** Folgas por semana (modelos semanais; parcial e personalizada usam os dias escolhidos). */
  folgasPorSemana?: number;
  /** Folgas em dias seguidos (5x2, 4x3). */
  folgasSeguidas?: boolean;
  /** Jornada diária normal (minutos) e máxima tolerada com compensação ou hora extra. */
  diariaNormal: number;
  diariaMaxima: number;
  /** Limite semanal (minutos) ou nulo quando o próprio regime compensa (12x36, 24x48). */
  semanalMaxima: number | null;
  /** Confere o repouso semanal (no máximo 6 dias seguidos) e o domingo de folga. */
  aplicaRepouso: boolean;
  /** Feriados considerados compensados pelo regime (art. 59-A, parágrafo único). */
  feriadosCompensados: boolean;
  /** Turno sugerido ao escolher o modelo. */
  turnoSugerido: Pick<Turno, "inicio" | "fim" | "intervaloMin">;
  indicadoPara: string;
  exige: string[];
  atencao: string[];
  base: BaseLegal[];
  /** Nível de cuidado jurídico: comum, pede documento, ou arriscado. */
  risco: "baixo" | "medio" | "alto";
}

const CLT = "https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm";
const CF = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm";
const LEI_10101 = "https://www.planalto.gov.br/ccivil_03/leis/l10101.htm";
const LEI_605 = "https://www.planalto.gov.br/ccivil_03/leis/l0605.htm";

const H44 = 44 * 60;

export const MODELOS: ModeloEscala[] = [
  {
    chave: "5x2",
    nome: "5x2",
    resumo: "Cinco dias de trabalho e duas folgas por semana.",
    comoFunciona:
      "A pessoa trabalha cinco dias e folga dois, normalmente seguidos (sábado e domingo, ou dois dias em rodízio quando a empresa abre todos os dias).",
    jornadaTipica: "8h48 de segunda a sexta (44h, compensando o sábado) ou 8h por dia (40h).",
    tipo: "semanal",
    folgasPorSemana: 2,
    folgasSeguidas: true,
    diariaNormal: 8 * 60,
    diariaMaxima: 10 * 60,
    semanalMaxima: H44,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "08:00", fim: "17:48", intervaloMin: 60 },
    indicadoPara: "Escritórios, indústria e comércio que fecham no fim de semana.",
    exige: ["Acima de 8h por dia (para compensar o sábado), acordo de compensação de jornada (art. 59, §§ 2º e 6º, da CLT)."],
    atencao: ["Se a empresa abre no fim de semana, as folgas precisam girar e o domingo de folga tem que aparecer ao menos a cada 3 semanas no comércio."],
    base: [
      { texto: "Constituição, art. 7º, XIII (8h por dia e 44h por semana)", url: CF },
      { texto: "CLT, art. 59, §§ 2º e 6º (compensação de jornada)", url: CLT },
    ],
    risco: "baixo",
  },
  {
    chave: "6x1",
    nome: "6x1",
    resumo: "Seis dias de trabalho e uma folga por semana.",
    comoFunciona:
      "A pessoa trabalha seis dias e folga um. Quando a empresa abre aos domingos, a folga gira para cair no domingo de tempos em tempos. Na semana em que a folga vai para o domingo, pode ser preciso dar mais uma folga para ninguém passar de 6 dias seguidos.",
    jornadaTipica: "7h20 por dia (44h por semana).",
    tipo: "semanal",
    folgasPorSemana: 1,
    diariaNormal: 8 * 60,
    diariaMaxima: 10 * 60,
    semanalMaxima: H44,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "08:00", fim: "16:20", intervaloMin: 60 },
    indicadoPara: "Comércio, supermercados, padarias, restaurantes e farmácias.",
    exige: [],
    atencao: [
      "No comércio, a folga precisa coincidir com o domingo pelo menos 1 vez a cada 3 semanas (Lei 10.101/2000).",
      "Empregadas mulheres: domingo de folga a cada 15 dias (art. 386 da CLT, que o TST vem aplicando).",
      "Ninguém pode trabalhar mais de 6 dias seguidos sem folga (OJ 410 do TST).",
    ],
    base: [
      { texto: "Constituição, art. 7º, XV, e CLT, art. 67 (repouso semanal)", url: CLT },
      { texto: "Lei 10.101/2000, art. 6º, parágrafo único (domingo no comércio)", url: LEI_10101 },
      { texto: "CLT, art. 386 (domingo quinzenal das empregadas)", url: CLT },
      { texto: "TST, OJ 410 da SDI-1 (folga depois do 7º dia viola a Constituição)" },
    ],
    risco: "baixo",
  },
  {
    chave: "12x36",
    nome: "12x36",
    resumo: "Doze horas de trabalho e trinta e seis de descanso.",
    comoFunciona:
      "A pessoa trabalha um dia de 12 horas e descansa o dia seguinte inteiro, alternando. Numa semana trabalha 3 dias e na outra 4 (média de 42h por semana). O descanso semanal e os feriados já são considerados compensados.",
    jornadaTipica: "07:00 às 19:00 (dia) ou 19:00 às 07:00 (noite), com 1h de intervalo concedida ou indenizada.",
    tipo: "ciclo",
    ciclo: { trabalho: 1, folga: 1 },
    diariaNormal: 12 * 60,
    diariaMaxima: 12 * 60,
    semanalMaxima: null,
    aplicaRepouso: false,
    feriadosCompensados: true,
    turnoSugerido: { inicio: "07:00", fim: "19:00", intervaloMin: 60 },
    indicadoPara: "Saúde, vigilância, portaria, hotelaria e serviços 24 horas.",
    exige: ["Acordo individual escrito, convenção coletiva ou acordo coletivo (art. 59-A da CLT)."],
    atencao: [
      "Turno noturno: hora noturna de 52min30s e adicional de no mínimo 20% (art. 73).",
      "Fazer hora extra com frequência descaracteriza a 12x36.",
    ],
    base: [{ texto: "CLT, art. 59-A, incluído pela Lei 13.467/2017", url: CLT }],
    risco: "medio",
  },
  {
    chave: "24x48",
    nome: "24x48",
    resumo: "Vinte e quatro horas de trabalho e quarenta e oito de descanso.",
    comoFunciona: "A pessoa trabalha um dia inteiro (24 horas) e descansa os dois dias seguintes.",
    jornadaTipica: "07:00 às 07:00 do dia seguinte.",
    tipo: "ciclo",
    ciclo: { trabalho: 1, folga: 2 },
    diariaNormal: 24 * 60,
    diariaMaxima: 24 * 60,
    semanalMaxima: null,
    aplicaRepouso: false,
    feriadosCompensados: true,
    turnoSugerido: { inicio: "07:00", fim: "07:00", intervaloMin: 120 },
    indicadoPara: "Algumas categorias com regra própria na convenção coletiva (por exemplo, parte da segurança e brigadas).",
    exige: ["Convenção ou acordo coletivo da categoria que autorize a escala. A CLT não prevê a 24x48."],
    atencao: [
      "A média passa de 50 horas por semana, acima do limite de 44h da Constituição.",
      "Há decisões da Justiça do Trabalho que não reconhecem a 24x48 nem com convenção coletiva: risco alto de condenação em horas extras.",
    ],
    base: [
      { texto: "Constituição, art. 7º, XIII e XXVI (limite de jornada e convenções coletivas)", url: CF },
      { texto: "CLT, art. 611-A (o que a convenção coletiva pode negociar)", url: CLT },
    ],
    risco: "alto",
  },
  {
    chave: "4x3",
    nome: "4x3 (semana de 4 dias)",
    resumo: "Quatro dias de trabalho e três folgas por semana.",
    comoFunciona: "A pessoa trabalha quatro dias, com jornadas um pouco maiores, e folga três dias seguidos.",
    jornadaTipica: "4 dias de 9h (36h) ou de 10h (40h).",
    tipo: "semanal",
    folgasPorSemana: 3,
    folgasSeguidas: true,
    diariaNormal: 8 * 60,
    diariaMaxima: 10 * 60,
    semanalMaxima: H44,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "08:00", fim: "19:00", intervaloMin: 60 },
    indicadoPara: "Empresas que querem reter funcionários e não precisam de todos todos os dias.",
    exige: ["Jornada acima de 8h: acordo de compensação de jornada (art. 59, §§ 2º e 6º, da CLT); no máximo 10h por dia."],
    atencao: ["Sem redução de salário, se a jornada semanal cair, é preciso ajustar o contrato."],
    base: [{ texto: "CLT, art. 59, §§ 2º e 6º (compensação de jornada)", url: CLT }],
    risco: "baixo",
  },
  {
    chave: "5x1",
    nome: "5x1",
    resumo: "Cinco dias de trabalho e uma folga, em ciclo de 6 dias.",
    comoFunciona:
      "A folga anda um dia para trás a cada semana (cai num dia diferente). Sozinha, ela só cai no domingo a cada 6 semanas; por isso o portal acrescenta folga no domingo quando a lei exige.",
    jornadaTipica: "7h20 por dia.",
    tipo: "ciclo",
    ciclo: { trabalho: 5, folga: 1 },
    diariaNormal: 8 * 60,
    diariaMaxima: 10 * 60,
    semanalMaxima: H44,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "08:00", fim: "16:20", intervaloMin: 60 },
    indicadoPara: "Supermercados, centros de distribuição e serviços que funcionam todos os dias.",
    exige: [],
    atencao: ["Em algumas semanas a pessoa trabalha 6 dias: com 7h20 por dia, chega a 44h."],
    base: [{ texto: "Constituição, art. 7º, XIII e XV", url: CF }],
    risco: "baixo",
  },
  {
    chave: "6x2",
    nome: "6x2",
    resumo: "Seis dias de trabalho e duas folgas seguidas, em ciclo de 8 dias.",
    comoFunciona: "A pessoa trabalha seis dias e folga dois. As folgas andam pela semana; o portal acrescenta folga no domingo quando a lei exige.",
    jornadaTipica: "7h20 por dia.",
    tipo: "ciclo",
    ciclo: { trabalho: 6, folga: 2 },
    diariaNormal: 8 * 60,
    diariaMaxima: 10 * 60,
    semanalMaxima: H44,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "06:00", fim: "14:20", intervaloMin: 60 },
    indicadoPara: "Indústria, logística e operações contínuas.",
    exige: [],
    atencao: ["Com mais de 7h20 por dia, as semanas de 6 dias passam de 44h."],
    base: [{ texto: "Constituição, art. 7º, XIII e XV", url: CF }],
    risco: "baixo",
  },
  {
    chave: "revezamento",
    nome: "Turnos de revezamento",
    resumo: "Turnos que se alternam (manhã, tarde e noite) com jornada de 6 horas.",
    comoFunciona:
      "A pessoa troca de turno depois de cada folga, cobrindo as 24 horas junto com os colegas. Pela Constituição, a jornada é de 6 horas; 8 horas só com negociação coletiva.",
    jornadaTipica: "Turnos de 6h (06–12, 12–18, 18–24, 00–06) com 15 minutos de intervalo.",
    tipo: "semanal",
    folgasPorSemana: 1,
    diariaNormal: 6 * 60,
    diariaMaxima: 6 * 60,
    semanalMaxima: 36 * 60,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "06:00", fim: "12:15", intervaloMin: 15 },
    indicadoPara: "Indústria de processo contínuo, usinas, frigoríficos.",
    exige: ["Turnos de 8 horas: convenção ou acordo coletivo (Súmula 423 do TST)."],
    atencao: ["Entre o fim de um turno e o começo do outro: no mínimo 11 horas (art. 66)."],
    base: [
      { texto: "Constituição, art. 7º, XIV (turnos ininterruptos de revezamento)", url: CF },
      { texto: "TST, Súmula 423 (8 horas por negociação coletiva)" },
    ],
    risco: "medio",
  },
  {
    chave: "parcial",
    nome: "Jornada parcial",
    resumo: "Até 30 horas por semana (ou até 26 horas com até 6 horas extras).",
    comoFunciona: "A pessoa trabalha só nos dias escolhidos, com jornada menor.",
    jornadaTipica: "6h de segunda a sexta (30h) ou 4h por dia.",
    tipo: "semanal",
    diariaNormal: 8 * 60,
    diariaMaxima: 8 * 60,
    semanalMaxima: 30 * 60,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "08:00", fim: "14:15", intervaloMin: 15 },
    indicadoPara: "Estudantes, reforço nos horários de pico, meio período.",
    exige: ["Contrato de trabalho em regime de tempo parcial (art. 58-A da CLT)."],
    atencao: ["Contrato de até 30h não pode ter hora extra; o de até 26h pode ter até 6h extras por semana."],
    base: [{ texto: "CLT, art. 58-A (trabalho em regime de tempo parcial)", url: CLT }],
    risco: "baixo",
  },
  {
    chave: "personalizada",
    nome: "Personalizada",
    resumo: "Dias e horários escolhidos por você.",
    comoFunciona: "Você escolhe em quais dias da semana a pessoa trabalha e o turno; o portal confere as regras da CLT.",
    jornadaTipica: "Qualquer combinação dentro de 8h por dia e 44h por semana.",
    tipo: "semanal",
    diariaNormal: 8 * 60,
    diariaMaxima: 10 * 60,
    semanalMaxima: H44,
    aplicaRepouso: true,
    feriadosCompensados: false,
    turnoSugerido: { inicio: "08:00", fim: "17:00", intervaloMin: 60 },
    indicadoPara: "Casos que não se encaixam nos modelos acima.",
    exige: [],
    atencao: [],
    base: [{ texto: "Constituição, art. 7º, XIII e XV", url: CF }, { texto: "Lei 605/1949 (repouso semanal remunerado)", url: LEI_605 }],
    risco: "baixo",
  },
];

export const MODELO_POR_CHAVE: Record<ChaveModelo, ModeloEscala> = Object.fromEntries(MODELOS.map((m) => [m.chave, m])) as Record<
  ChaveModelo,
  ModeloEscala
>;

/** Tamanho do ciclo (modelos de ciclo) ou 7 (modelos semanais). */
export function tamanhoCiclo(m: ModeloEscala) {
  return m.ciclo ? m.ciclo.trabalho + m.ciclo.folga : 7;
}

/** Quantas folgas por semana a pessoa precisa, no modelo dela. */
export function folgasNecessarias(m: ModeloEscala, diasTrabalho: readonly number[]) {
  if (m.chave === "parcial" || m.chave === "personalizada") return 7 - new Set(diasTrabalho).size;
  return m.folgasPorSemana ?? 1;
}

/** Jornada diária máxima do modelo, considerando as regras da empresa. */
export function limitesDiarios(m: ModeloEscala, revezamento8h: boolean) {
  if (m.chave === "revezamento" && revezamento8h) return { normal: 8 * 60, maxima: 8 * 60 };
  return { normal: m.diariaNormal, maxima: m.diariaMaxima };
}

export function limiteSemanal(m: ModeloEscala, revezamento8h: boolean) {
  if (m.chave === "revezamento" && revezamento8h) return 44 * 60;
  return m.semanalMaxima;
}
