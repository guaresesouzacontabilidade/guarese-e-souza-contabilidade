import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, mix, pickNext, afterAnswer, sessionCounts } from '../../js/core/queue.js';
import { answer, newCardState, GOOD, AGAIN } from '../../js/core/srs.js';
import { MINUTE, dayStart, dayNumber } from '../../js/core/dates.js';

const NOW = new Date(2026, 10, 11, 15, 0).getTime();
const note = (id, extra = {}) => ({ id, deckId: 'd1', type: 'basic', front: id, back: 'r', createdAt: 1, ...extra });

test('mistura novos entre revisões', () => {
  assert.deepEqual(mix(['r1', 'r2', 'r3', 'r4'], ['n1', 'n2']).map((c) => c.id), ['r1', 'r2', 'n1', 'r3', 'r4', 'n2']);
  assert.deepEqual(mix([], ['n1']).map((c) => c.kind), ['new']);
});

test('fila respeita limite de novos, baralhos e vencimento', () => {
  const notes = [note('a', { createdAt: 1 }), note('b', { createdAt: 2 }), note('c', { createdAt: 3 }), note('x', { deckId: 'd2' })];
  const cards = {
    'c~0': { ...newCardState(), state: 'review', ivl: 3, due: dayStart(dayNumber(NOW)) },
  };
  const q = buildQueue({ notes, cards, deckIds: new Set(['d1']), now: NOW, newLimit: 1 });
  assert.deepEqual(q.counts, { learning: 0, review: 1, fresh: 1 });
  assert.equal(q.newTotal, 2);
  const ids = q.main.map((c) => c.id);
  assert.ok(ids.includes('c~0') && ids.includes('a~0'));
});

test('lacunas da mesma nota ficam em rodadas separadas', () => {
  const notes = [
    { id: 'n1', deckId: 'd', type: 'cloze', front: '{{c1::a}} {{c2::b}}', createdAt: 1 },
    { id: 'n2', deckId: 'd', type: 'cloze', front: '{{c1::c}} {{c2::d}}', createdAt: 2 },
  ];
  const q = buildQueue({ notes, cards: {}, now: NOW, newLimit: 10 });
  assert.deepEqual(q.main.map((c) => c.id), ['n1~1', 'n2~1', 'n1~2', 'n2~2']);
});

test('sessão: cartão errado volta depois, e só aparece antes se não houver outro', () => {
  const notes = [note('a'), note('b')];
  const q = buildQueue({ notes, cards: {}, now: NOW, newLimit: 10 });
  let session = { learning: q.learning, main: q.main };
  const first = pickNext(session, NOW);
  assert.equal(first.id, 'a~0');
  const s1 = answer(newCardState(), AGAIN, NOW);
  session = afterAnswer(session, first.id, s1, NOW);
  assert.deepEqual(sessionCounts(session), { fresh: 1, learning: 1, review: 0 });
  // 'a' só volta em 1 min: agora vem 'b'.
  assert.equal(pickNext(session, NOW).id, 'b~0');
  const s2 = answer(newCardState(), GOOD, NOW);
  session = afterAnswer(session, 'b~0', s2, NOW);
  // Sem cartões principais: adianta os de aprendizado (até 20 min).
  assert.equal(pickNext(session, NOW).id, 'a~0');
  // Gradua os dois: acabou.
  session = afterAnswer(session, 'a~0', { state: 'review', due: NOW + 86400000 }, NOW);
  session = afterAnswer(session, 'b~0', { state: 'review', due: NOW + 86400000 }, NOW);
  assert.equal(pickNext(session, NOW), null);
});

test('cartão suspenso ou nota apagada não entra', () => {
  const notes = [note('a', { deleted: true }), note('b')];
  const q = buildQueue({ notes, cards: { 'b~0': { suspended: true } }, now: NOW });
  assert.equal(q.main.length, 0);
});

test('aprendizado que vence depois do fim do dia fica para amanhã', () => {
  const notes = [note('a')];
  const late = new Date(2026, 10, 12, 3, 50).getTime();
  const s = answer(newCardState(), GOOD, late); // +10 min → 4h00 = outro dia
  const session = afterAnswer({ learning: [], main: [{ id: 'a~0', kind: 'new' }] }, 'a~0', s, late);
  assert.equal(session.learning.length, 0);
  assert.equal(s.due, late + 10 * MINUTE);
});
