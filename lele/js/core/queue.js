// Fila de estudo: o que aparece hoje e em que ordem.
import { cardOrds, cardId } from './notes.js';
import { endOfStudyDay, MINUTE } from './dates.js';

export const LEARN_AHEAD = 20 * MINUTE;

/**
 * Monta a fila do dia.
 * - notes: lista de notas; cards: { [cardId]: estado } (cartão sem estado = novo)
 * - deckIds: Set de baralhos incluídos (null = todos)
 * - newLimit: quantos cartões novos ainda podem entrar hoje
 */
export function buildQueue({ notes, cards, deckIds = null, now = Date.now(), newLimit = 20 }) {
  const endDay = endOfStudyDay(now);
  const learning = [];
  const review = [];
  const freshByNote = [];
  let newTotal = 0;
  for (const note of notes) {
    if (note.deleted || note.suspended) continue;
    if (deckIds && !deckIds.has(note.deckId)) continue;
    const fresh = [];
    for (const ord of cardOrds(note)) {
      const id = cardId(note.id, ord);
      const c = cards[id];
      if (c?.suspended) continue;
      if (!c || c.state === 'new') {
        fresh.push(id);
        newTotal += 1;
      } else if (c.state === 'learning' || c.state === 'relearning') {
        if (c.due < endDay) learning.push({ id, due: c.due });
      } else if (c.due < endDay) review.push({ id, due: c.due });
    }
    if (fresh.length) freshByNote.push({ createdAt: note.createdAt || 0, ids: fresh });
  }
  learning.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due);
  // Novos: na ordem em que foram criados, mas cartões irmãos (lacunas da mesma nota)
  // ficam em "rodadas" diferentes para um não entregar a resposta do outro.
  freshByNote.sort((a, b) => a.createdAt - b.createdAt);
  const fresh = [];
  for (let round = 0; fresh.length < newLimit; round++) {
    let added = false;
    for (const n of freshByNote) {
      if (n.ids[round]) {
        fresh.push(n.ids[round]);
        added = true;
        if (fresh.length >= newLimit) break;
      }
    }
    if (!added) break;
  }
  return {
    learning,
    main: mix(review.map((r) => r.id), fresh),
    counts: { learning: learning.length, review: review.length, fresh: fresh.length },
    newTotal,
  };
}

// Espalha os cartões novos entre as revisões.
export function mix(reviews, fresh) {
  if (!fresh.length) return reviews.map((id) => ({ id, kind: 'review' }));
  if (!reviews.length) return fresh.map((id) => ({ id, kind: 'new' }));
  const out = [];
  const step = (reviews.length + fresh.length) / fresh.length;
  let r = 0;
  let f = 0;
  for (let i = 0; i < reviews.length + fresh.length; i++) {
    const wantNew = f < fresh.length && (r >= reviews.length || i + 1 >= Math.round((f + 1) * step));
    if (wantNew) out.push({ id: fresh[f++], kind: 'new' });
    else out.push({ id: reviews[r++], kind: 'review' });
  }
  return out;
}

/**
 * Próximo cartão da sessão.
 * session = { learning: [{id, due}], main: [{id, kind}] }
 * Devolve { id, kind, from } ou null quando acabou (ou só restam cartões para mais tarde).
 */
export function pickNext(session, now = Date.now()) {
  const learning = [...session.learning].sort((a, b) => a.due - b.due);
  if (learning[0] && learning[0].due <= now) return { id: learning[0].id, kind: 'learning', from: 'learning' };
  if (session.main.length) return { ...session.main[0], from: 'main' };
  if (learning[0] && learning[0].due <= now + LEARN_AHEAD) return { id: learning[0].id, kind: 'learning', from: 'learning' };
  return null;
}

// Depois de responder: tira o cartão da fila e, se ainda está aprendendo hoje, devolve para mais tarde.
export function afterAnswer(session, id, nextState, now = Date.now()) {
  const learning = session.learning.filter((c) => c.id !== id);
  const main = session.main.filter((c) => c.id !== id);
  if ((nextState.state === 'learning' || nextState.state === 'relearning') && nextState.due < endOfStudyDay(now)) {
    learning.push({ id, due: nextState.due });
  }
  return { learning, main };
}

// Contadores mostrados no topo do estudo (novos · aprendendo · revisar).
export function sessionCounts(session) {
  let fresh = 0;
  let review = 0;
  for (const c of session.main) {
    if (c.kind === 'new') fresh += 1;
    else review += 1;
  }
  return { fresh, learning: session.learning.length, review };
}

// Próximo cartão em aprendizado que ainda vai voltar hoje (para avisar "volte em X min").
export function nextLearningDue(session) {
  if (!session.learning.length) return null;
  return Math.min(...session.learning.map((c) => c.due));
}
