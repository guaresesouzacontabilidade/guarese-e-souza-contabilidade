import test from 'node:test';
import assert from 'node:assert/strict';
import { answer, previewIntervals, formatInterval, newCardState, AGAIN, HARD, GOOD, EASY, maturity } from '../../js/core/srs.js';
import { dayNumber, dayStart, dayKey, endOfStudyDay, MINUTE } from '../../js/core/dates.js';

const NOW = new Date(2026, 10, 11, 15, 0).getTime(); // 11/11/2026 15h (local)

test('dia de estudo vira às 4h', () => {
  const before = new Date(2026, 10, 12, 3, 30).getTime();
  const after = new Date(2026, 10, 12, 4, 30).getTime();
  assert.equal(dayKey(before), '2026-11-11');
  assert.equal(dayKey(after), '2026-11-12');
  assert.equal(dayStart(dayNumber(NOW) + 1), endOfStudyDay(NOW));
  assert.equal(new Date(endOfStudyDay(NOW)).getHours(), 4);
});

test('cartão novo: Bom passa pelas etapas e depois gradua em 1 dia', () => {
  let c = newCardState();
  c = answer(c, GOOD, NOW);
  assert.equal(c.state, 'learning');
  assert.equal(c.step, 1);
  assert.equal(c.due, NOW + 10 * MINUTE);
  c = answer(c, GOOD, NOW + 10 * MINUTE);
  assert.equal(c.state, 'review');
  assert.equal(c.ivl, 1);
  assert.equal(c.due, dayStart(dayNumber(NOW) + 1));
  assert.equal(c.reps, 2);
});

test('cartão novo: Errei volta em 1 min; Fácil gradua em 4 dias', () => {
  const again = answer(newCardState(), AGAIN, NOW);
  assert.equal(again.due, NOW + MINUTE);
  assert.equal(again.state, 'learning');
  const easy = answer(newCardState(), EASY, NOW);
  assert.equal(easy.state, 'review');
  assert.equal(easy.ivl, 4);
});

test('Difícil na primeira etapa usa a média das etapas (5,5 min)', () => {
  const hard = answer(newCardState(), HARD, NOW);
  assert.equal(hard.due, NOW + 5.5 * MINUTE);
});

test('revisão: intervalos crescem e respeitam Difícil < Bom < Fácil', () => {
  const card = { ...newCardState(), state: 'review', ivl: 10, ease: 2.5, due: dayStart(dayNumber(NOW)) };
  const h = answer(card, HARD, NOW);
  const g = answer(card, GOOD, NOW);
  const e = answer(card, EASY, NOW);
  assert.equal(h.ivl, 12);
  assert.equal(g.ivl, 25);
  assert.equal(e.ivl, 33);
  assert.ok(h.ease < 2.5 && e.ease > 2.5 && g.ease === 2.5);
});

test('revisão: Errei vira reaprendizado, conta lapso e reduz a facilidade', () => {
  const card = { ...newCardState(), state: 'review', ivl: 30, ease: 2.5, due: NOW };
  const c = answer(card, AGAIN, NOW);
  assert.equal(c.state, 'relearning');
  assert.equal(c.lapses, 1);
  assert.equal(c.ease, 2.3);
  assert.equal(c.due, NOW + 10 * MINUTE);
  const back = answer(c, GOOD, NOW + 10 * MINUTE);
  assert.equal(back.state, 'review');
  assert.equal(back.ivl, 1);
});

test('facilidade nunca fica abaixo de 1,3', () => {
  let card = { ...newCardState(), state: 'review', ivl: 5, ease: 1.35, due: NOW };
  card = answer(card, AGAIN, NOW);
  assert.equal(card.ease, 1.3);
});

test('variação (fuzz) mantém o intervalo maior que o anterior', () => {
  const card = { ...newCardState(), state: 'review', ivl: 3, ease: 1.3, due: NOW };
  for (const v of [0, 0.5, 0.999]) {
    const c = answer(card, HARD, NOW, undefined, () => v);
    assert.ok(c.ivl >= 4, `ivl ${c.ivl}`);
  }
});

test('prévia e formatação dos intervalos', () => {
  const p = previewIntervals(newCardState(), NOW);
  assert.equal(formatInterval(p[AGAIN]), '1 min');
  assert.equal(formatInterval(p[HARD]), '6 min');
  assert.equal(formatInterval(p[GOOD]), '10 min');
  assert.equal(formatInterval(p[EASY]), '4 dias');
  assert.equal(formatInterval({ days: 1 }), '1 dia');
  assert.equal(formatInterval({ days: 45 }), '1,5 mês');
  assert.equal(formatInterval({ days: 400 }), '1,1 ano');
  assert.equal(formatInterval({ minutes: 90 }), '2 h');
});

test('maturidade', () => {
  assert.equal(maturity(undefined), 'new');
  assert.equal(maturity({ state: 'learning' }), 'learning');
  assert.equal(maturity({ state: 'review', ivl: 5 }), 'young');
  assert.equal(maturity({ state: 'review', ivl: 21 }), 'mature');
});
