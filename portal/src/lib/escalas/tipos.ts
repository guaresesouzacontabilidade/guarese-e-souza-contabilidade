import { z } from "zod";

/**
 * Tipos da escala de trabalho (configuração e grade), com validação.
 * Usado no servidor (ações, conferência) e no navegador (editor).
 */

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
/** Ordem de exibição (segunda a domingo). */
export const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

export const CHAVES_MODELO = ["5x2", "6x1", "12x36", "24x48", "4x3", "5x1", "6x2", "revezamento", "parcial", "personalizada"] as const;
export type ChaveModelo = (typeof CHAVES_MODELO)[number];

export const ATIVIDADES = ["comercio", "industria", "servicos", "saude", "outra"] as const;
export type Atividade = (typeof ATIVIDADES)[number];
export const ROTULO_ATIVIDADE: Record<Atividade, string> = {
  comercio: "Comércio (lojas, mercados, padarias)",
  industria: "Indústria",
  servicos: "Serviços (escritórios, oficinas, restaurantes)",
  saude: "Saúde, segurança ou portaria",
  outra: "Outra atividade",
};

/** Códigos que não são turno: folga (inclui o repouso semanal), férias e afastamento. */
export const AUSENCIAS = { F: "Folga", FE: "Férias", AF: "Afastamento" } as const;
export type CodigoAusencia = keyof typeof AUSENCIAS;
export type CodigoDia = CodigoAusencia | `T${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ID_TURNO = /^T[1-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hora = z.string().regex(HORA, "Hora no formato HH:MM.");
export const idTurno = z.string().regex(ID_TURNO);
const diaSemana = z.number().int().min(0).max(6);

export const turnoSchema = z.object({
  id: idTurno,
  nome: z.string().trim().min(1).max(30),
  inicio: hora,
  /** Fim igual ou antes do início: o turno passa da meia-noite (igual = 24 horas). */
  fim: hora,
  intervaloMin: z.number().int().min(0).max(240),
});
export type Turno = z.infer<typeof turnoSchema>;

export const pessoaSchema = z.object({
  id: z.string().regex(UUID),
  nome: z.string().trim().min(1).max(120),
  cargo: z.string().max(80).nullable(),
  jornadaSemanal: z.number().positive().max(44),
  naoTrabalha: z.array(diaSemana).max(7),
  domingoQuinzenal: z.boolean(),
  menorIdade: z.boolean(),
  modelo: z.enum(CHAVES_MODELO),
  /** Turno de trabalho; no revezamento, os turnos em rodízio (troca depois de cada folga). */
  turnos: z.array(idTurno).min(1).max(4),
  /** Jornada parcial e personalizada: dias da semana em que trabalha. */
  diasTrabalho: z.array(diaSemana).max(7),
  /** Dias da semana preferidos para a folga. */
  folgasPreferidas: z.array(diaSemana).max(7),
  /** Posição no ciclo (espalha as folgas entre as pessoas). */
  deslocamento: z.number().int().min(0).max(60),
});
export type Pessoa = z.infer<typeof pessoaSchema>;

export const regrasSchema = z.object({
  atividade: z.enum(ATIVIDADES),
  /** Domingo de folga ao menos uma vez a cada N semanas (3 no comércio; 7 com autorização do Ministério do Trabalho). */
  domingoACadaSemanas: z.union([z.literal(3), z.literal(7)]),
  /** Intervalo de almoço reduzido a 30 minutos por convenção ou acordo coletivo (art. 611-A, III). */
  intervaloReduzido: z.boolean(),
  /** A empresa abre nos feriados (se não, todos folgam). */
  trabalhaFeriados: z.boolean(),
  /** Turnos de revezamento de 8 horas autorizados por negociação coletiva (Súmula 423 do TST). */
  revezamento8h: z.boolean(),
});
export type Regras = z.infer<typeof regrasSchema>;

export const feriadoSchema = z.object({ data: z.string().regex(DATA), nome: z.string().trim().min(1).max(80) });
export type Feriado = z.infer<typeof feriadoSchema>;

export const coberturaSchema = z.object({ turno: idTurno, minimo: z.array(z.number().int().min(0).max(200)).length(7) });

export const configSchema = z
  .object({
    versao: z.literal(1),
    turnos: z.array(turnoSchema).min(1).max(9),
    /** Funcionamento da empresa em cada dia da semana (0 = domingo). */
    funcionamento: z.array(z.object({ aberto: z.boolean(), inicio: hora, fim: hora })).length(7),
    /** Mínimo de pessoas em cada turno, por dia da semana (0 = domingo). */
    cobertura: z.array(coberturaSchema).max(9),
    regras: regrasSchema,
    feriados: z.array(feriadoSchema).max(40),
    pessoas: z.array(pessoaSchema).max(200),
  })
  .superRefine((c, ctx) => {
    const ids = new Set(c.turnos.map((t) => t.id));
    if (ids.size !== c.turnos.length) ctx.addIssue({ code: "custom", message: "Turnos com o mesmo código." });
    c.pessoas.forEach((p, i) => {
      if (p.turnos.some((t) => !ids.has(t))) ctx.addIssue({ code: "custom", path: ["pessoas", i, "turnos"], message: `Turno inexistente para ${p.nome}.` });
    });
    if (new Set(c.pessoas.map((p) => p.id)).size !== c.pessoas.length) ctx.addIssue({ code: "custom", message: "Pessoa repetida na escala." });
    c.cobertura.forEach((k, i) => {
      if (!ids.has(k.turno)) ctx.addIssue({ code: "custom", path: ["cobertura", i], message: "Cobertura de turno inexistente." });
    });
  });
export type ConfigEscala = z.infer<typeof configSchema>;

export const codigoDia = z.string().regex(/^(T[1-9]|F|FE|AF)$/);
/** Grade: para cada pessoa, o código de cada dia do mês (posição 0 = dia 1). */
export const gradeSchema = z.record(z.string().regex(UUID), z.array(codigoDia).max(31));
export type Grade = Record<string, string[]>;

/** Últimos dias do mês anterior de cada pessoa (para continuar as contagens de folga e domingo). */
export type Historico = Record<string, string[]>;

export function ehTurno(codigo: string | undefined): codigo is `T${number}` {
  return Boolean(codigo && ID_TURNO.test(codigo));
}

/** Dias do mês (datas em UTC) a partir de "AAAA-MM-01". */
export function diasDoMes(competencia: string): Date[] {
  const [a, m] = competencia.split("-").map(Number);
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => new Date(Date.UTC(a, m - 1, i + 1)));
}

export function isoData(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Dias desde 01/01/1970 (contagem contínua de um mês para o outro). */
export function diaAbsoluto(d: Date) {
  return Math.floor(d.getTime() / 86_400_000);
}

export function configPadrao(): ConfigEscala {
  return {
    versao: 1,
    turnos: [{ id: "T1", nome: "Comercial", inicio: "08:00", fim: "16:20", intervaloMin: 60 }],
    funcionamento: [
      { aberto: false, inicio: "08:00", fim: "12:00" },
      ...Array.from({ length: 5 }, () => ({ aberto: true, inicio: "08:00", fim: "18:00" })),
      { aberto: true, inicio: "08:00", fim: "12:00" },
    ],
    cobertura: [{ turno: "T1", minimo: [0, 1, 1, 1, 1, 1, 1] }],
    regras: { atividade: "comercio", domingoACadaSemanas: 3, intervaloReduzido: false, trabalhaFeriados: false, revezamento8h: false },
    feriados: [],
    pessoas: [],
  };
}
