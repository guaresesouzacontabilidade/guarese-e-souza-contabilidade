// Estatísticas: sequência de dias, revisões por dia, acertos e previsão.
import { dayNumber, numberFromKey, keyFromNumber, endOfStudyDay } from './dates.js';
import { cardOrds, cardId } from './notes.js';
import { maturity } from './srs.js';

/**
 * Junta os registros diários (um por aparelho) em um mapa por dia.
 * logs: [{ day: 'AAAA-MM-DD', reviews, again, fresh, ms, revAnswers, revCorrect }]
 */
export function byDay(logs) {
  const map = new Map();
  for (const l of logs) {
    if (!l || l.deleted || !l.day) continue;
    const cur = map.get(l.day) || { reviews: 0, again: 0, fresh: 0, ms: 0, revAnswers: 0, revCorrect: 0 };
    cur.reviews += l.reviews || 0;
    cur.again += l.again || 0;
    cur.fresh += l.fresh || 0;
    cur.ms += l.ms || 0;
    cur.revAnswers += l.revAnswers || 0;
    cur.revCorrect += l.revCorrect || 0;
    map.set(l.day, cur);
  }
  return map;
}

// Dias seguidos estudando. Se hoje ainda não estudou, a sequência de ontem continua valendo.
export function streak(days, now = Date.now()) {
  const today = dayNumber(now);
  const studied = (n) => (days.get(keyFromNumber(n))?.reviews || 0) > 0;
  let n = studied(today) ? today : today - 1;
  let count = 0;
  while (studied(n)) {
    count += 1;
    n -= 1;
  }
  return { current: count, studiedToday: studied(today) };
}

export function bestStreak(days) {
  const nums = [...days.entries()]
    .filter(([, v]) => v.reviews > 0)
    .map(([k]) => numberFromKey(k))
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const n of nums) {
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  return best;
}

// Últimos `n` dias (mais antigo primeiro) com o total de revisões.
export function lastDays(days, n = 30, now = Date.now()) {
  const today = dayNumber(now);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const num = today - i;
    const d = days.get(keyFromNumber(num));
    out.push({ num, key: keyFromNumber(num), reviews: d?.reviews || 0, ms: d?.ms || 0 });
  }
  return out;
}

// Percentual de acertos nas revisões (cartões que já estavam na fase de revisão).
export function retention(days, n = 30, now = Date.now()) {
  let answers = 0;
  let correct = 0;
  for (const d of lastDays(days, n, now)) {
    const v = days.get(d.key);
    answers += v?.revAnswers || 0;
    correct += v?.revCorrect || 0;
  }
  return answers ? { pct: Math.round((correct / answers) * 100), answers } : { pct: null, answers: 0 };
}

// Quantos cartões existem em cada fase (opcionalmente só de alguns baralhos).
export function cardCounts(notes, cards, deckIds = null) {
  const out = { new: 0, learning: 0, young: 0, mature: 0, total: 0 };
  for (const note of notes) {
    if (note.deleted) continue;
    if (deckIds && !deckIds.has(note.deckId)) continue;
    for (const ord of cardOrds(note)) {
      out[maturity(cards[cardId(note.id, ord)])] += 1;
      out.total += 1;
    }
  }
  return out;
}

// Revisões previstas para os próximos `n` dias (hoje inclui o que já está atrasado).
export function forecast(notes, cards, n = 7, now = Date.now()) {
  const today = dayNumber(now);
  const out = Array.from({ length: n }, (_, i) => ({ num: today + i, count: 0 }));
  const endToday = endOfStudyDay(now);
  for (const note of notes) {
    if (note.deleted) continue;
    for (const ord of cardOrds(note)) {
      const c = cards[cardId(note.id, ord)];
      if (!c || c.state === 'new' || c.suspended) continue;
      const idx = c.due < endToday ? 0 : dayNumber(c.due) - today;
      if (idx >= 0 && idx < n) out[idx].count += 1;
    }
  }
  return out;
}

export function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
