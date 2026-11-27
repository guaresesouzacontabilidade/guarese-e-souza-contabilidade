/**
 * Escalas de trabalho de DEMONSTRAÇÃO (dados fictícios): funcionários da
 * padaria e a escala do mês atual, montada pelo próprio gerador do portal e
 * publicada. O assistente de IA fica desconectado na demonstração (sem chave).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { feriadosNacionais } from "../src/lib/escalas/feriados";
import { distribuirDeslocamentos, gerarGrade } from "../src/lib/escalas/gerador";
import { configPadrao, type ConfigEscala, type Pessoa } from "../src/lib/escalas/tipos";

function competenciaAtual() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function semearEscalas(admin: SupabaseClient, padaria: string): Promise<boolean> {
  const { count } = await admin.from("escala_funcionarios").select("id", { count: "exact", head: true }).eq("empresa_id", padaria);
  if (count) return false;

  const pessoas = [
    { nome: "Ana Souza (DEMO)", cargo: "Padeira", jornada_semanal: 44, domingo_quinzenal: true, preferencias: "Prefere o turno da manhã." },
    { nome: "Bruno Lima (DEMO)", cargo: "Atendente", jornada_semanal: 44 },
    { nome: "Carla Mendes (DEMO)", cargo: "Confeiteira", jornada_semanal: 44, preferencias: "Gosta de folgar no domingo." },
    { nome: "Diego Alves (DEMO)", cargo: "Atendente", jornada_semanal: 44 },
    { nome: "Elisa Prado (DEMO)", cargo: "Atendente (meio período)", jornada_semanal: 20, nao_trabalha: [0, 6], domingo_quinzenal: true, preferencias: "Faz faculdade de manhã." },
    { nome: "Felipe Rocha (DEMO)", cargo: "Auxiliar de padaria", jornada_semanal: 44, menor_idade: true },
  ];
  const { data: criados, error } = await admin
    .from("escala_funcionarios")
    .insert(pessoas.map((p) => ({ empresa_id: padaria, nao_trabalha: [], domingo_quinzenal: false, menor_idade: false, ...p })))
    .select("id, nome, cargo, jornada_semanal, nao_trabalha, domingo_quinzenal, menor_idade");
  if (error || !criados) throw new Error(`Falha ao criar os funcionários de demonstração da escala: ${error?.message}`);

  const plano: Record<string, Pick<Pessoa, "modelo" | "turnos" | "diasTrabalho" | "folgasPreferidas">> = {
    "Ana Souza (DEMO)": { modelo: "6x1", turnos: ["T1"], diasTrabalho: [], folgasPreferidas: [] },
    "Bruno Lima (DEMO)": { modelo: "6x1", turnos: ["T2"], diasTrabalho: [], folgasPreferidas: [] },
    "Carla Mendes (DEMO)": { modelo: "5x2", turnos: ["T1"], diasTrabalho: [], folgasPreferidas: [0] },
    "Diego Alves (DEMO)": { modelo: "6x1", turnos: ["T1"], diasTrabalho: [], folgasPreferidas: [] },
    "Elisa Prado (DEMO)": { modelo: "parcial", turnos: ["T3"], diasTrabalho: [1, 2, 3, 4, 5], folgasPreferidas: [] },
    "Felipe Rocha (DEMO)": { modelo: "6x1", turnos: ["T2"], diasTrabalho: [], folgasPreferidas: [] },
  };
  const competencia = competenciaAtual();
  const config: ConfigEscala = {
    ...configPadrao(),
    turnos: [
      { id: "T1", nome: "Manhã", inicio: "06:00", fim: "14:20", intervaloMin: 60 },
      { id: "T2", nome: "Tarde", inicio: "11:40", fim: "20:00", intervaloMin: 60 },
      { id: "T3", nome: "Fim de tarde", inicio: "16:00", fim: "20:15", intervaloMin: 15 },
    ],
    funcionamento: Array.from({ length: 7 }, () => ({ aberto: true, inicio: "06:00", fim: "20:00" })),
    cobertura: [
      { turno: "T1", minimo: [1, 2, 2, 2, 2, 2, 2] },
      { turno: "T2", minimo: [1, 1, 1, 1, 1, 1, 1] },
    ],
    regras: { atividade: "comercio", domingoACadaSemanas: 3, intervaloReduzido: false, trabalhaFeriados: false, revezamento8h: false },
    feriados: feriadosNacionais(competencia),
    pessoas: distribuirDeslocamentos(
      criados.map((f) => ({
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        jornadaSemanal: Number(f.jornada_semanal),
        naoTrabalha: f.nao_trabalha ?? [],
        domingoQuinzenal: f.domingo_quinzenal,
        menorIdade: f.menor_idade,
        deslocamento: 0,
        ...plano[f.nome],
      })),
    ),
  };
  const grade = gerarGrade(config, competencia);
  const { error: e2 } = await admin
    .from("escalas")
    .insert({ empresa_id: padaria, nome: "Padaria — balcão e produção", competencia, config, grade, status: "publicada" });
  if (e2) throw new Error(`Falha ao criar a escala de demonstração: ${e2.message}`);
  return true;
}
