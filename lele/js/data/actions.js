// Ações do app (criar baralho, salvar cartão, responder…), em cima do store.
import * as store from './store.js';
import { cardOrds, cardId } from '../core/notes.js';
import { answer as srsAnswer, newCardState } from '../core/srs.js';
import { dayKey, dayNumber } from '../core/dates.js';
import { buildQueue } from '../core/queue.js';
import { byDay } from '../core/stats.js';

export const DECK_COLORS = ['#E0457B', '#8B5CF6', '#3B82F6', '#14B8A6', '#22A06B', '#F59E0B', '#F97316', '#EF4444', '#64748B'];
export const DECK_EMOJIS = ['🫀', '🫁', '🧠', '🩺', '💊', '🦴', '🩸', '🧬', '🦠', '👶', '🤰', '🧪', '🩻', '🔬', '📚', '⭐'];

// ---------- Baralhos ----------

export function createDeck({ name, color, emoji, group = '' }) {
  const decks = store.list('decks');
  const deck = {
    id: store.newId('d'),
    name: name.trim(),
    group: group.trim(),
    color: color || DECK_COLORS[decks.length % DECK_COLORS.length],
    emoji: emoji || '📚',
    createdAt: Date.now(),
  };
  store.put('decks', deck);
  return deck;
}

export function updateDeck(id, patch) {
  const deck = store.get('decks', id);
  if (deck) store.put('decks', { ...deck, ...patch });
}

// Apaga o baralho com todas as notas, cartões e imagens.
export function deleteDeck(id) {
  const notes = store.list('notes').filter((n) => n.deckId === id);
  store.putMany([...store.tombstones('decks', [id]), ...notes.flatMap(noteTombstones)]);
}

function noteTombstones(note) {
  const s = store.getState();
  const cardIds = Object.keys(s.cards).filter((cid) => cid.startsWith(`${note.id}~`) && !s.cards[cid].deleted);
  const out = [...store.tombstones('notes', [note.id]), ...store.tombstones('cards', cardIds)];
  if (note.image && store.get('media', note.image)) out.push(...store.tombstones('media', [note.image]));
  return out;
}

// ---------- Notas ----------

export function saveNote(input) {
  const prev = input.id ? store.get('notes', input.id) : null;
  const note = {
    // Mantém o que o editor não mostra (pausado, contexto, origem no Notion…).
    ...(prev || {}),
    id: input.id || store.newId('n'),
    deckId: input.deckId,
    type: input.type || 'basic',
    front: (input.front || '').trim(),
    back: input.type === 'cloze' ? '' : (input.back || '').trim(),
    extra: (input.extra || '').trim(),
    tags: input.tags || [],
    image: input.image || null,
    imageSide: input.imageSide || 'back',
    createdAt: prev?.createdAt || Date.now(),
  };
  delete note.updatedAt;
  // Cartão que veio do Notion e foi editado aqui: "Atualizar do Notion" não mexe mais nele.
  if (prev?.source && ['type', 'front', 'back', 'extra'].some((k) => (prev[k] || '') !== (note[k] || ''))) {
    note.source = { ...prev.source, edited: true };
  }
  const entries = [['notes', note]];
  if (prev) {
    // Lacunas removidas: os cartões delas somem; imagem trocada: a antiga também.
    const keep = new Set(cardOrds(note).map((o) => cardId(note.id, o)));
    const s = store.getState();
    const gone = Object.keys(s.cards).filter((cid) => cid.startsWith(`${note.id}~`) && !keep.has(cid) && !s.cards[cid].deleted);
    entries.push(...store.tombstones('cards', gone));
    if (prev.image && prev.image !== note.image) entries.push(...store.tombstones('media', [prev.image]));
  }
  store.putMany(entries);
  return note;
}

export function deleteNote(id) {
  const note = store.get('notes', id);
  if (note) store.putMany(noteTombstones(note));
}

export function moveNotes(ids, deckId) {
  store.putMany(ids.map((id) => store.get('notes', id)).filter(Boolean).map((n) => ['notes', { ...n, deckId }]));
}

// Volta o cartão (ou todos da nota) a ser novo.
export function resetNote(id) {
  const note = store.get('notes', id);
  if (!note) return;
  const s = store.getState();
  const ids = cardOrds(note).map((o) => cardId(note.id, o)).filter((cid) => s.cards[cid] && !s.cards[cid].deleted);
  store.putMany(store.tombstones('cards', ids));
}

export function setSuspended(id, suspended) {
  const note = store.get('notes', id);
  if (note) store.put('notes', { ...note, suspended });
}

export function addMedia(data, w, h) {
  const media = { id: store.newId('m'), data, w, h };
  store.put('media', media);
  return media.id;
}

export function importCards(deckId, cards) {
  const base = Date.now();
  const entries = cards.map((c, i) => [
    'notes',
    {
      id: store.newId('n'),
      deckId,
      type: c.type,
      front: c.front,
      back: c.back || '',
      extra: c.extra || '',
      tags: c.tags || [],
      image: null,
      imageSide: 'back',
      createdAt: base + i,
    },
  ]);
  store.putMany(entries);
  return entries.length;
}

// ---------- Estudo ----------

const logId = (day) => `${day}~${store.getState().meta.deviceId}`;

/**
 * Registra uma resposta. Devolve o que é preciso para desfazer.
 * kind: 'new' | 'learning' | 'review' (fase do cartão antes de responder)
 */
export function recordAnswer(id, rating, { ms = 0, now = Date.now() } = {}) {
  const s = store.getState();
  const prevCard = s.cards[id] && !s.cards[id].deleted ? s.cards[id] : null;
  const before = prevCard || { id, ...newCardState() };
  const next = { ...srsAnswer(before, rating, now, undefined, Math.random), id };
  const day = dayKey(now);
  const lid = logId(day);
  const prevLog = s.logs[lid] && !s.logs[lid].deleted ? s.logs[lid] : null;
  const log = { id: lid, day, device: s.meta.deviceId, reviews: 0, again: 0, fresh: 0, ms: 0, revAnswers: 0, revCorrect: 0, ...(prevLog || {}) };
  log.reviews += 1;
  if (rating === 1) log.again += 1;
  if (before.state === 'new') log.fresh += 1;
  if (before.state === 'review') {
    log.revAnswers += 1;
    if (rating > 1) log.revCorrect += 1;
  }
  log.ms += Math.min(ms, 5 * 60 * 1000);
  store.putMany([
    ['cards', next],
    ['logs', log],
  ]);
  return { id, prevCard, prevLog, logId: lid, next };
}

export function undoAnswer(undo) {
  const entries = [];
  entries.push(undo.prevCard ? ['cards', undo.prevCard] : ['cards', { id: undo.id, deleted: true }]);
  if (undo.prevLog) entries.push(['logs', undo.prevLog]);
  else entries.push(['logs', { id: undo.logId, deleted: true }]);
  store.putMany(entries);
}

// Quantos cartões novos já entraram hoje (somando todos os aparelhos).
export function newSeenToday(now = Date.now()) {
  const day = byDay(store.list('logs')).get(dayKey(now));
  return day?.fresh || 0;
}

export function newLimitLeft(now = Date.now()) {
  return Math.max(0, store.settings().newPerDay - newSeenToday(now));
}

export function todayQueue(deckIds = null, now = Date.now()) {
  return buildQueue({
    notes: store.list('notes'),
    cards: store.getState().cards,
    deckIds,
    now,
    newLimit: newLimitLeft(now),
  });
}

// Treino livre: todos os cartões do baralho, embaralhados, sem mexer na agenda.
export function cramQueue(deckIds) {
  const ids = [];
  for (const note of store.list('notes')) {
    if (note.suspended || (deckIds && !deckIds.has(note.deckId))) continue;
    for (const ord of cardOrds(note)) ids.push(cardId(note.id, ord));
  }
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

export const todayNumber = () => dayNumber();
