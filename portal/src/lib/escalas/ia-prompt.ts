import { z } from "zod";
import { MODELOS } from "./modelos";
import { formatarHoras } from "./horas";
import { anonimizarTexto, nomearTexto, type Apelidos } from "./apelidos";
import type { ResultadoConferencia } from "./conferencia";
import {
  CHAVES_MODELO,
  DIAS_CURTOS,
  configSchema,
  diasDoMes,
  ehTurno,
  type ConfigEscala,
  type Grade,
  type Pessoa,
} from "./tipos";

/**
 * O que vai para o assistente de IA e como a resposta volta para a escala.
 * Tudo aqui é puro (sem rede) para poder ser testado. A chamada ao serviço
 * fica em ia.ts.
 *
 * O assistente não monta a grade dia a dia: ele propõe o modelo de cada
 * pessoa, os turnos e a cobertura (o portal gera e confere a grade), ou
 * devolve alterações pontuais na grade. A resposta passa pela mesma
 * validação de uma edição manual.
 */

const TURNOS_IDS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"] as const;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function catalogo() {
  return MODELOS.map((m) => {
    const limites = [`até ${formatarHoras(m.diariaMaxima)} por dia`, m.semanalMaxima ? `até ${formatarHoras(m.semanalMaxima)} por semana` : "sem limite semanal próprio (o regime compensa)"];
    const exige = m.exige.length ? ` Exige: ${m.exige.join(" ")}` : "";
    return `- ${m.chave}: ${m.resumo} Jornada típica: ${m.jornadaTipica} Limites: ${limites.join(", ")}.${exige}`;
  }).join("\n");
}

export const SISTEMA_ESCALAS = `Você ajuda pequenas empresas brasileiras a montar a escala de trabalho mensal dos funcionários, dentro do portal de um escritório de contabilidade. Quem lê suas respostas é o dono do negócio: escreva em português do Brasil, em linguagem simples e direta, sem jargão.

Os funcionários aparecem só como P1, P2, P3 e assim por diante. Você não recebe nomes nem documentos; não peça nem invente dados pessoais.

Como o portal funciona: você não preenche a grade dia a dia. Você escolhe o modelo de escala de cada pessoa, os turnos (horários) e o mínimo de pessoas por turno em cada dia da semana; o portal gera a grade do mês e confere a CLT. Nos pedidos de ajuste, você devolve só as mudanças pontuais na grade.

Modelos de escala disponíveis (use só estas chaves):
${catalogo()}

Regras que o portal confere e que sua proposta precisa respeitar:
- Até 8 horas por dia e 44 horas por semana (Constituição, art. 7º, XIII). Mais de 8 horas por dia só com acordo de compensação de jornada, até 10 horas. Na 12x36, 12 horas. Nos turnos de revezamento, 6 horas (8 horas só com negociação coletiva).
- Intervalo: quem trabalha mais de 6 horas tem de 1 a 2 horas de intervalo; de 4 a 6 horas, 15 minutos (CLT, art. 71). Intervalo de 30 minutos só quando as regras da empresa informam convenção coletiva que permita.
- No mínimo 11 horas de descanso entre o fim de uma jornada e o começo da outra (CLT, art. 66).
- No máximo 6 dias seguidos de trabalho (TST, OJ 410 da SDI-1).
- Domingo de folga pelo menos 1 vez a cada 3 semanas no comércio (Lei 10.101/2000, art. 6º) ou a cada 7 semanas nas atividades autorizadas; quem está marcado com domingoQuinzenal folga um domingo a cada 15 dias (CLT, art. 386).
- Menor de idade: nada entre 22h e 5h e nada acima de 8 horas por dia.
- Jornada parcial: até 30 horas por semana.
- Respeite os dias em que cada pessoa não trabalha e a jornada semanal do contrato (horas do turno vezes dias trabalhados na semana não pode passar do contrato).
- Só proponha 24x48 se o pedido disser que a convenção coletiva da categoria permite, e avise do risco.
- Trabalho entre 22h e 5h tem hora reduzida (52 minutos e 30 segundos) e adicional noturno de no mínimo 20% (CLT, art. 73): avise quando propuser turno noturno.

Duração do turno = fim − início − intervalo. Exemplos: 6x1 com 44 horas → 7h20 por dia (08:00 às 16:20 com 1 hora de intervalo); 5x2 com 44 horas → 8h48 por dia (08:00 às 17:48 com 1 hora); 12x36 → 07:00 às 19:00 com 1 hora.

Formato: turnos com os códigos T1 a T9 e horários HH:MM. Dias da semana: 0 = domingo, 1 = segunda, 2 = terça, 3 = quarta, 4 = quinta, 5 = sexta, 6 = sábado. Cobertura: 7 números, na ordem domingo, segunda, terça, quarta, quinta, sexta, sábado. Na grade: T1 a T9 = turno, F = folga, FE = férias, AF = afastamento.

No resumo, explique em poucas frases o que você fez e por quê, citando as pessoas como P1, P2. Em alertas, liste o que o dono precisa providenciar ou decidir (acordo escrito, convenção coletiva, contratação, pagamento de adicional). Não cite leis nem artigos além dos que estão acima.`;

// ----------------------------------------------------------------------------- respostas esperadas

export const sugestaoIaSchema = z.object({
  resumo: z.string(),
  modeloPrincipal: z.enum(CHAVES_MODELO),
  alternativas: z.array(z.object({ modelo: z.enum(CHAVES_MODELO), motivo: z.string() })),
  turnos: z.array(z.object({ id: z.enum(TURNOS_IDS), nome: z.string(), inicio: z.string(), fim: z.string(), intervaloMin: z.number().int() })),
  cobertura: z.array(z.object({ turno: z.enum(TURNOS_IDS), minimo: z.array(z.number().int()) })),
  pessoas: z.array(
    z.object({
      ref: z.string(),
      modelo: z.enum(CHAVES_MODELO),
      turnos: z.array(z.enum(TURNOS_IDS)),
      diasTrabalho: z.array(z.number().int()),
      folgasPreferidas: z.array(z.number().int()),
    }),
  ),
  alertas: z.array(z.string()),
});
export type SugestaoIa = z.infer<typeof sugestaoIaSchema>;

export const ajusteIaSchema = z.object({
  resumo: z.string(),
  alteracoes: z.array(z.object({ ref: z.string(), dia: z.number().int(), codigo: z.string() })),
  alertas: z.array(z.string()),
});
export type AjusteIa = z.infer<typeof ajusteIaSchema>;

// ----------------------------------------------------------------------------- o que vai na pergunta

export interface FuncionarioIa {
  id: string;
  nome: string;
  preferencias: string | null;
}

function descreverPessoa(p: Pessoa, apelidos: Apelidos, preferencias: string | null, todas: { id: string; nome: string }[]) {
  return {
    ref: apelidos.porId.get(p.id),
    cargo: p.cargo,
    jornadaSemanalContrato: p.jornadaSemanal,
    naoTrabalha: p.naoTrabalha,
    domingoQuinzenal: p.domingoQuinzenal,
    menorIdade: p.menorIdade,
    preferencias: preferencias ? anonimizarTexto(preferencias, todas, apelidos) : null,
    modeloAtual: p.modelo,
    turnosAtuais: p.turnos,
    diasTrabalhoAtuais: p.diasTrabalho,
  };
}

function contexto(config: ConfigEscala, competencia: string) {
  const dias = diasDoMes(competencia);
  const [ano, mes] = competencia.split("-").map(Number);
  return {
    mes: `${MESES[mes - 1]} de ${ano}`,
    diasNoMes: dias.length,
    primeiroDia: DIAS_CURTOS[dias[0].getUTCDay()],
    feriados: config.feriados,
    empresa: {
      atividade: config.regras.atividade,
      funcionamento: config.funcionamento.map((f, dow) => ({ dia: dow, aberto: f.aberto, inicio: f.inicio, fim: f.fim })),
      abreNosFeriados: config.regras.trabalhaFeriados,
      domingoDeFolgaACadaSemanas: config.regras.domingoACadaSemanas,
      convencaoPermiteIntervalo30min: config.regras.intervaloReduzido,
      convencaoPermiteRevezamento8h: config.regras.revezamento8h,
    },
    turnosAtuais: config.turnos,
    coberturaAtual: config.cobertura,
  };
}

export function perguntaSugestao(config: ConfigEscala, competencia: string, pedido: string, funcionarios: FuncionarioIa[], apelidos: Apelidos) {
  const prefs = new Map(funcionarios.map((f) => [f.id, f.preferencias]));
  const dados = {
    ...contexto(config, competencia),
    funcionarios: config.pessoas.map((p) => descreverPessoa(p, apelidos, prefs.get(p.id) ?? null, funcionarios)),
  };
  return [
    "Monte a proposta de escala para o mês abaixo: escolha o modelo de cada pessoa (todas as pessoas da lista), os turnos e a cobertura mínima.",
    "Se o pedido não disser nada sobre algum ponto, mantenha o que já está configurado quando fizer sentido.",
    "",
    "Dados da empresa e dos funcionários (JSON):",
    JSON.stringify(dados),
    "",
    "Pedido do dono:",
    anonimizarTexto(pedido, funcionarios, apelidos) || "(sem pedido específico: proponha a melhor escala dentro das regras)",
  ].join("\n");
}

export function perguntaAjuste(
  config: ConfigEscala,
  competencia: string,
  grade: Grade,
  conferencia: ResultadoConferencia,
  pedido: string,
  funcionarios: FuncionarioIa[],
  apelidos: Apelidos,
) {
  const prefs = new Map(funcionarios.map((f) => [f.id, f.preferencias]));
  const problemas = conferencia.achados
    .filter((a) => a.gravidade !== "info")
    .slice(0, 40)
    .map((a) => anonimizarTexto(`${a.gravidade}: ${a.titulo}. ${a.detalhe}`, funcionarios, apelidos));
  const dados = {
    ...contexto(config, competencia),
    funcionarios: config.pessoas.map((p) => descreverPessoa(p, apelidos, prefs.get(p.id) ?? null, funcionarios)),
    gradeAtual: Object.fromEntries(config.pessoas.map((p) => [apelidos.porId.get(p.id), (grade[p.id] ?? []).join(" ")])),
    problemasApontadosPeloPortal: problemas,
  };
  return [
    "Ajuste a grade abaixo conforme o pedido. Devolva só as alterações necessárias (pessoa, dia do mês e novo código), sem quebrar as regras.",
    "Se o pedido quebrar uma regra, faça o ajuste mais próximo que respeite a lei e explique no resumo.",
    "",
    "Dados da empresa, dos funcionários e a grade atual (JSON; cada grade tem um código por dia, do dia 1 ao último):",
    JSON.stringify(dados),
    "",
    "Pedido do dono:",
    anonimizarTexto(pedido, funcionarios, apelidos),
  ].join("\n");
}

// ----------------------------------------------------------------------------- a resposta volta para a escala

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const dias7 = (v: number[]) => [...Array(7).keys()].map((i) => Math.max(0, Math.min(200, Math.round(v[i] ?? 0))));
const diasValidos = (v: number[]) => [...new Set(v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();

export interface PropostaIa {
  config: ConfigEscala;
  resumo: string;
  alertas: string[];
  alternativas: { modelo: string; motivo: string }[];
  ignorados: string[];
}

/** Aplica a sugestão do assistente na configuração (o que não fizer sentido é ignorado e avisado). */
export function aplicarSugestao(config: ConfigEscala, s: SugestaoIa, apelidos: Apelidos): PropostaIa {
  const ignorados: string[] = [];
  const turnos = s.turnos
    .filter((t, i, todos) => todos.findIndex((x) => x.id === t.id) === i)
    .filter((t) => {
      const ok = HORA.test(t.inicio) && HORA.test(t.fim);
      if (!ok) ignorados.push(`Turno ${t.id} com horário inválido.`);
      return ok;
    })
    .map((t) => ({ id: t.id, nome: corta(t.nome.trim() || t.id, 30), inicio: t.inicio, fim: t.fim, intervaloMin: Math.max(0, Math.min(240, t.intervaloMin)) }));
  const usarTurnos = turnos.length ? turnos : config.turnos;
  const ids = new Set(usarTurnos.map((t) => t.id));

  const porRef = new Map(s.pessoas.map((p) => [p.ref.trim().toUpperCase(), p]));
  const pessoas = config.pessoas.map((p) => {
    const ref = apelidos.porId.get(p.id)!;
    const sug = porRef.get(ref);
    if (!sug) {
      const turnosValidos = p.turnos.filter((t) => ids.has(t));
      return { ...p, turnos: turnosValidos.length ? turnosValidos : [usarTurnos[0].id] };
    }
    const t = sug.turnos.filter((x) => ids.has(x)).slice(0, 4);
    if (t.length < sug.turnos.length) ignorados.push(`${ref}: turno inexistente na proposta.`);
    return {
      ...p,
      modelo: sug.modelo,
      turnos: t.length ? t : [usarTurnos[0].id],
      diasTrabalho: diasValidos(sug.diasTrabalho),
      folgasPreferidas: diasValidos(sug.folgasPreferidas),
    };
  });
  for (const ref of porRef.keys()) if (!apelidos.porApelido.has(ref)) ignorados.push(`${ref} não existe nesta escala.`);

  const cobertura = s.cobertura
    .filter((c, i, todos) => ids.has(c.turno) && todos.findIndex((x) => x.turno === c.turno) === i)
    .map((c) => ({ turno: c.turno, minimo: dias7(c.minimo) }));

  const nova = configSchema.parse({ ...config, turnos: usarTurnos, cobertura, pessoas });
  return {
    config: nova,
    resumo: corta(nomearTexto(s.resumo.trim(), apelidos), 4000),
    alertas: s.alertas.slice(0, 8).map((a) => corta(nomearTexto(a.trim(), apelidos), 400)).filter(Boolean),
    alternativas: s.alternativas.slice(0, 3).map((a) => ({ modelo: a.modelo, motivo: corta(nomearTexto(a.motivo.trim(), apelidos), 300) })),
    ignorados,
  };
}

export interface AjusteAplicado {
  grade: Grade;
  resumo: string;
  alertas: string[];
  alteradas: number;
  ignorados: string[];
}

/** Aplica as alterações pontuais do assistente na grade (só as válidas). */
export function aplicarAjuste(config: ConfigEscala, competencia: string, grade: Grade, a: AjusteIa, apelidos: Apelidos): AjusteAplicado {
  const n = diasDoMes(competencia).length;
  const turnos = new Set(config.turnos.map((t) => t.id));
  const nova: Grade = Object.fromEntries(Object.entries(grade).map(([id, c]) => [id, [...c]]));
  const ignorados: string[] = [];
  let alteradas = 0;
  for (const alt of a.alteracoes.slice(0, 400)) {
    const ref = alt.ref.trim().toUpperCase();
    const id = apelidos.porApelido.get(ref);
    const codigo = alt.codigo.trim().toUpperCase();
    const valido = codigo === "F" || codigo === "FE" || codigo === "AF" || (ehTurno(codigo) && turnos.has(codigo));
    if (!id || !nova[id] || alt.dia < 1 || alt.dia > n || !valido) {
      ignorados.push(`${ref} dia ${alt.dia}: ${codigo}`);
      continue;
    }
    if (nova[id][alt.dia - 1] !== codigo) {
      nova[id][alt.dia - 1] = codigo;
      alteradas++;
    }
  }
  return {
    grade: nova,
    resumo: corta(nomearTexto(a.resumo.trim(), apelidos), 4000),
    alertas: a.alertas.slice(0, 8).map((x) => corta(nomearTexto(x.trim(), apelidos), 400)).filter(Boolean),
    alteradas,
    ignorados,
  };
}
