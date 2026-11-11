// Datas de estudo. Como no Anki, o "dia" vira às 4h da manhã:
// quem estuda de madrugada ainda está no dia anterior.

export const DAY_START_HOUR = 4;
const HOUR = 3600 * 1000;
export const MINUTE = 60 * 1000;
export const DAY = 24 * HOUR;

// Número do dia de estudo (dias desde 1970 no fuso local, com a virada às 4h).
export function dayNumber(ts = Date.now()) {
  const d = new Date(ts - DAY_START_HOUR * HOUR);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

// Momento em que começa o dia de estudo de número `n` (4h locais).
export function dayStart(n) {
  const d = new Date(n * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_START_HOUR).getTime();
}

export const endOfStudyDay = (ts = Date.now()) => dayStart(dayNumber(ts) + 1);

// 'AAAA-MM-DD' do dia de estudo.
export function dayKey(ts = Date.now()) {
  return keyFromNumber(dayNumber(ts));
}

export function keyFromNumber(n) {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export function numberFromKey(key) {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / DAY);
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function weekdayShort(n) {
  return WEEKDAYS[new Date(n * DAY).getUTCDay()];
}

export function shortDate(n) {
  const d = new Date(n * DAY);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function greeting(ts = Date.now()) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}
