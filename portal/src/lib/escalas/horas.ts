import type { Turno } from "./tipos";

/** "07:30" → 450 minutos. */
export function minutos(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Tempo entre o início e o fim do turno (passa da meia-noite quando o fim é menor; igual = 24 horas). */
export function duracaoBruta(t: Pick<Turno, "inicio" | "fim">) {
  const d = (minutos(t.fim) - minutos(t.inicio) + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

/** Horas efetivamente trabalhadas no turno (sem o intervalo). */
export function duracaoTrabalho(t: Turno) {
  return Math.max(0, duracaoBruta(t) - t.intervaloMin);
}

/**
 * Minutos trabalhados entre 22h e 5h (trabalho noturno urbano, art. 73 da CLT).
 * Como não se sabe a hora exata do intervalo, ele é descontado na proporção.
 */
export function minutosNoturnos(t: Turno) {
  const inicio = minutos(t.inicio);
  const bruto = duracaoBruta(t);
  let noturno = 0;
  for (let dia = -1; dia <= 2; dia++) {
    const a = dia * 1440 + 22 * 60;
    const b = dia * 1440 + 29 * 60;
    noturno += Math.max(0, Math.min(inicio + bruto, b) - Math.max(inicio, a));
  }
  if (!noturno) return 0;
  return Math.round(noturno * (duracaoTrabalho(t) / bruto));
}

/** 440 → "7h20"; 480 → "8h". */
export function formatarHoras(min: number) {
  const sinal = min < 0 ? "-" : "";
  const v = Math.abs(Math.round(min));
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${sinal}${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

/** Texto do turno: "08:00–17:20 (1h de intervalo)". */
export function descreverTurno(t: Turno) {
  const intervalo = t.intervaloMin ? ` · intervalo ${formatarHoras(t.intervaloMin)}` : " · sem intervalo";
  return `${t.inicio}–${t.fim}${intervalo} · ${formatarHoras(duracaoTrabalho(t))} de trabalho`;
}
