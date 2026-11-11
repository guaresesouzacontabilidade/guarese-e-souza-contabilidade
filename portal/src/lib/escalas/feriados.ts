import type { Feriado } from "./tipos";

/**
 * Feriados nacionais (Lei 662/1949, Lei 6.802/1980 e Lei 14.759/2023) e a
 * Sexta-feira da Paixão (feriado religioso, Lei 9.093/1995, adotado em quase
 * todos os municípios). Carnaval e Corpus Christi são ponto facultativo
 * nacional: só viram feriado quando a lei do estado ou do município declara,
 * por isso aparecem como sugestão. Feriados estaduais e municipais são
 * acrescentados na escala por quem a monta.
 */

const FIXOS: [mes: number, dia: number, nome: string][] = [
  [1, 1, "Confraternização Universal"],
  [4, 21, "Tiradentes"],
  [5, 1, "Dia do Trabalho"],
  [9, 7, "Independência do Brasil"],
  [10, 12, "Nossa Senhora Aparecida"],
  [11, 2, "Finados"],
  [11, 15, "Proclamação da República"],
  [11, 20, "Dia Nacional de Zumbi e da Consciência Negra"],
  [12, 25, "Natal"],
];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function somarDias(d: Date, n: number) {
  return new Date(d.getTime() + n * 86_400_000);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Feriados nacionais (e a Sexta-feira da Paixão) do mês "AAAA-MM-01". */
export function feriadosNacionais(competencia: string): Feriado[] {
  const [ano, mes] = competencia.split("-").map(Number);
  const lista: Feriado[] = FIXOS.filter(([m]) => m === mes).map(([m, d, nome]) => ({
    data: `${ano}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    nome,
  }));
  const paixao = somarDias(pascoa(ano), -2);
  if (paixao.getUTCMonth() + 1 === mes) lista.push({ data: iso(paixao), nome: "Sexta-feira da Paixão" });
  return lista.sort((a, b) => a.data.localeCompare(b.data));
}

/** Datas que são feriado só onde a lei local declara (sugestões). */
export function datasFacultativas(competencia: string): Feriado[] {
  const [ano, mes] = competencia.split("-").map(Number);
  const p = pascoa(ano);
  return [
    { data: iso(somarDias(p, -48)), nome: "Carnaval (segunda-feira)" },
    { data: iso(somarDias(p, -47)), nome: "Carnaval (terça-feira)" },
    { data: iso(somarDias(p, 60)), nome: "Corpus Christi" },
  ].filter((f) => Number(f.data.slice(5, 7)) === mes);
}
