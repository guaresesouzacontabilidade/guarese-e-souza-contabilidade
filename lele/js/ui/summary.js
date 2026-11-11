// Números calculados a partir dos dados (com cache enquanto nada muda).
import * as store from '../data/store.js';
import { buildQueue } from '../core/queue.js';
import { cardCounts, byDay, streak, retention } from '../core/stats.js';
import { newLimitLeft } from '../data/actions.js';
import { dayKey } from '../core/dates.js';

let cache = null;

export function summary(now = Date.now()) {
  const s = store.getState();
  const key = [s.notes, s.cards, s.logs, s.decks, s.settings, dayKey(now), Math.floor(now / 60000)];
  if (cache && cache.key.every((v, i) => v === key[i])) return cache.value;

  const notes = store.list('notes');
  const decks = store.list('decks');
  const newLimit = newLimitLeft(now);
  const byDeck = new Map(decks.map((d) => [d.id, []]));
  for (const n of notes) byDeck.get(n.deckId)?.push(n);

  const perDeck = new Map();
  for (const d of decks) {
    const dn = byDeck.get(d.id) || [];
    const q = buildQueue({ notes: dn, cards: s.cards, now, newLimit });
    perDeck.set(d.id, { due: q.counts, cards: cardCounts(dn, s.cards), notes: dn.length });
  }
  const all = buildQueue({ notes: notes.filter((n) => byDeck.has(n.deckId)), cards: s.cards, now, newLimit });
  const days = byDay(store.list('logs'));
  const today = days.get(dayKey(now)) || { reviews: 0, ms: 0 };
  const value = {
    perDeck,
    due: all.counts,
    dueTotal: all.counts.fresh + all.counts.learning + all.counts.review,
    newTotal: all.newTotal,
    newLimit,
    days,
    today,
    streak: streak(days, now),
    retention: retention(days, 30, now),
  };
  cache = { key, value };
  return value;
}

// Baralhos agrupados (grupos em ordem alfabética, "sem grupo" primeiro).
export function groupedDecks() {
  const decks = [...store.list('decks')].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const groups = new Map();
  for (const d of decks) {
    const g = d.group?.trim() || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'pt-BR')));
}
