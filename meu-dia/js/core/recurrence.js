// Repetições: semanal, mensal e anual, sempre calculadas a partir da data original.
import { addDays, addMonths, addYears, diffDays, monthsBetween } from './dates.js';

export const REPEAT_OPTIONS = [
  { id: 'none', label: 'Não repete' },
  { id: 'weekly', label: 'Toda semana' },
  { id: 'monthly', label: 'Todo mês' },
  { id: 'yearly', label: 'Todo ano' },
];

export const repeatLabel = (id) => (REPEAT_OPTIONS.find((o) => o.id === id) || REPEAT_OPTIONS[0]).label;

export const isRecurring = (item) => !!item.repeat && item.repeat !== 'none';

export function nthOccurrence(start, repeat, k) {
  if (repeat === 'weekly') return addDays(start, 7 * k);
  if (repeat === 'monthly') return addMonths(start, k);
  if (repeat === 'yearly') return addYears(start, k);
  return start;
}

function firstIndexNear(start, repeat, from) {
  if (from <= start) return 0;
  if (repeat === 'weekly') return Math.max(0, Math.floor(diffDays(start, from) / 7));
  if (repeat === 'monthly') return Math.max(0, monthsBetween(start, from) - 1);
  if (repeat === 'yearly') return Math.max(0, Math.floor(monthsBetween(start, from) / 12) - 1);
  return 0;
}

// Datas em que o item acontece entre `from` e `to` (inclusive).
export function occurrencesBetween(item, from, to, limit = 1000) {
  const start = item.date;
  const skip = new Set(item.skipDates || []);
  if (!isRecurring(item)) {
    return start >= from && start <= to && !skip.has(start) ? [start] : [];
  }
  const out = [];
  for (let k = firstIndexNear(start, item.repeat, from); out.length < limit; k++) {
    const d = nthOccurrence(start, item.repeat, k);
    if (d > to || (item.repeatUntil && d > item.repeatUntil)) break;
    if (d >= from && !skip.has(d)) out.push(d);
  }
  return out;
}

// Primeira ocorrência a partir de `from` (ou null).
export function nextOccurrence(item, from) {
  if (!isRecurring(item)) return item.date >= from && !(item.skipDates || []).includes(item.date) ? item.date : null;
  const found = occurrencesBetween(item, from, addYears(from, 2), 1);
  return found[0] || null;
}
