// Compromissos e tarefas: ocorrências, conclusão, busca.
import { occurrencesBetween, isRecurring } from './recurrence.js';
import { matchesQuery } from './text.js';
import { minutesOf } from './dates.js';

export const KIND_LABEL = { event: 'Compromisso', task: 'Tarefa' };

export const PRIORITIES = [
  { id: 'low', label: 'Baixa' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Alta' },
];

export const EVENT_REMINDERS = [
  { id: null, label: 'Sem lembrete' },
  { id: 0, label: 'Na hora' },
  { id: 10, label: '10 min antes' },
  { id: 30, label: '30 min antes' },
  { id: 60, label: '1 hora antes' },
  { id: 1440, label: '1 dia antes' },
];

export function reminderLabel(minutes) {
  const found = EVENT_REMINDERS.find((r) => r.id === minutes);
  return found ? found.label : `${minutes} min antes`;
}

export function isDoneOn(item, date) {
  if (item.kind !== 'task') return false;
  return isRecurring(item) ? (item.doneDates || []).includes(date) : !!item.done;
}

export function compareOccurrences(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = a.item.time ? minutesOf(a.item.time) : -1;
  const tb = b.item.time ? minutesOf(b.item.time) : -1;
  if (ta !== tb) return ta - tb;
  return a.item.title.localeCompare(b.item.title, 'pt-BR');
}

export function occurrencesInRange(events, from, to) {
  const out = [];
  for (const item of events) {
    if (item.deleted) continue;
    for (const date of occurrencesBetween(item, from, to)) {
      out.push({ key: `${item.id}@${date}`, item, date, done: isDoneOn(item, date) });
    }
  }
  return out.sort(compareOccurrences);
}

export function occurrencesOnDay(events, date) {
  return occurrencesInRange(events, date, date);
}

// Tarefas sem repetição de dias anteriores que ainda não foram feitas.
export function overdueTasks(events, today) {
  return events
    .filter((e) => !e.deleted && e.kind === 'task' && !isRecurring(e) && !e.done && e.date < today)
    .map((item) => ({ key: `${item.id}@${item.date}`, item, date: item.date, done: false, overdue: true }))
    .sort(compareOccurrences);
}

// O que mostrar no "Hoje": compromissos que ainda não passaram e tarefas pendentes primeiro.
export function todayAgenda(events, today, nowHM) {
  const list = occurrencesOnDay(events, today);
  const nowMin = minutesOf(nowHM);
  const isPast = (o) => o.item.kind === 'event' && o.item.time && minutesOf(o.item.endTime || o.item.time) + (o.item.endTime ? 0 : 60) < nowMin;
  const upcoming = list.filter((o) => !o.done && !isPast(o));
  const finished = list.filter((o) => o.done || isPast(o));
  return { upcoming, finished, total: list.length };
}

export function searchAgenda(events, query, { kind = 'all', status = 'all', category = 'all' } = {}) {
  return events
    .filter((e) => !e.deleted)
    .filter((e) => kind === 'all' || e.kind === kind)
    .filter((e) => category === 'all' || e.category === category)
    .filter((e) => {
      if (status === 'all') return true;
      const done = e.kind === 'task' && !isRecurring(e) && e.done;
      return status === 'done' ? done : !done;
    })
    .filter((e) => matchesQuery([e.title, e.location, e.notes], query))
    .sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date < b.date ? 1 : -1));
}

export function daysWithItems(events, from, to) {
  const map = new Map();
  for (const occ of occurrencesInRange(events, from, to)) {
    const entry = map.get(occ.date) || { events: 0, tasks: 0, pending: 0 };
    if (occ.item.kind === 'event') entry.events++;
    else entry.tasks++;
    if (occ.item.kind === 'task' && !occ.done) entry.pending++;
    map.set(occ.date, entry);
  }
  return map;
}
