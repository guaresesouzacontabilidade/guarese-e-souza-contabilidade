// Datas como texto local 'AAAA-MM-DD' para evitar surpresas de fuso horário.

const pad = (n) => String(n).padStart(2, '0');

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISODate(parseISODate(iso)) === iso;
}

export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Soma meses mantendo o dia; se o mês for mais curto, usa o último dia (31/01 + 1 mês = 28/02).
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addYears(iso, n) {
  return addMonths(iso, 12 * n);
}

// Quantos dias de `a` até `b` (positivo se b for depois).
export function diffDays(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}

export function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export const monthKey = (iso) => iso.slice(0, 7);
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;

export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

export const weekday = (iso) => parseISODate(iso).getDay();

// Semana de domingo a sábado, como nos calendários brasileiros.
export const startOfWeek = (iso) => addDays(iso, -weekday(iso));
export const endOfWeek = (iso) => addDays(startOfWeek(iso), 6);
export const startOfYear = (iso) => `${iso.slice(0, 4)}-01-01`;
export const endOfYear = (iso) => `${iso.slice(0, 4)}-12-31`;

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthName(iso) {
  return MONTHS[Number(iso.slice(5, 7)) - 1];
}

// "terça-feira, 14 de outubro"
export function formatLongDate(iso) {
  const d = parseISODate(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

// "14 de outubro" (com ano se for de outro ano)
export function formatDayMonth(iso, today) {
  const d = parseISODate(iso);
  const base = `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  return today && today.slice(0, 4) !== iso.slice(0, 4) ? `${base} de ${d.getFullYear()}` : base;
}

// "14 out"
export function formatShort(iso) {
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

// "14/10/2026"
export function formatNumeric(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

// "outubro de 2026"
export function formatMonthYear(iso) {
  return `${monthName(iso)} de ${iso.slice(0, 4)}`;
}

export function relativeDay(iso, today) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff > 1 && diff <= 6) return WEEKDAYS[weekday(iso)].replace('-feira', '');
  return formatDayMonth(iso, today);
}

export function dueLabel(iso, today) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'vence hoje';
  if (diff === 1) return 'vence amanhã';
  if (diff > 1) return diff <= 30 ? `vence em ${diff} dias` : `vence em ${formatDayMonth(iso, today)}`;
  if (diff === -1) return 'venceu ontem';
  return `venceu há ${-diff} dias`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function timeHM(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function minutesOf(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

// Data/hora local em milissegundos.
export function toTimestamp(iso, hm = '00:00') {
  const d = parseISODate(iso);
  const [h, m] = hm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
