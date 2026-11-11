import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, detectSeparator, splitLine, htmlToText } from '../../js/core/importer.js';
import { byDay, streak, bestStreak, retention, cardCounts, forecast, lastDays } from '../../js/core/stats.js';
import { dayStart, dayNumber, keyFromNumber } from '../../js/core/dates.js';

test('importa com ponto e vírgula, tab e ::', () => {
  const r = parseImport('Causa de IAM ; Aterosclerose\nFC normal ; 60-100 bpm\n');
  assert.equal(r.separator, 'semicolon');
  assert.equal(r.cards.length, 2);
  assert.deepEqual(r.cards[0], { type: 'basic', front: 'Causa de IAM', back: 'Aterosclerose', extra: '', tags: [] });
  assert.equal(parseImport('a\tb\nc\td').separator, 'tab');
  assert.equal(parseImport('a :: b\nc :: d').cards[1].back, 'd');
});

test('lacunas importadas, inclusive com {{…}} sem número', () => {
  const r = parseImport('O {{c1::VE}} bombeia para a aorta\nA {{valva mitral}} separa AE e VE ; extra');
  assert.equal(r.cards[0].type, 'cloze');
  assert.equal(r.cards[1].front, 'A {{c1::valva mitral}} separa AE e VE');
  assert.equal(r.cards[1].extra, 'extra');
});

test('blocos separados por linha em branco', () => {
  const text = 'P: Qual o tratamento da anafilaxia?\nR: Adrenalina IM\n\nTríade de Beck?\n- Hipotensão\n- Turgência jugular\n- Bulhas abafadas';
  const r = parseImport(text);
  assert.equal(r.separator, 'blocks');
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[0].front, 'Qual o tratamento da anafilaxia?');
  assert.equal(r.cards[0].back, 'Adrenalina IM');
  assert.ok(r.cards[1].back.includes('Bulhas abafadas'));
});

test('linhas sem resposta são puladas e mostradas', () => {
  const r = parseImport('a ; b\nsó pergunta ;\n# comentário');
  assert.equal(r.cards.length, 1);
  assert.deepEqual(r.skipped, ['só pergunta ;']);
});

test('CSV com aspas e HTML do Anki', () => {
  assert.deepEqual(splitLine('"a; b";"c ""d"""', ';'), ['a; b', 'c "d"']);
  assert.equal(htmlToText('<b>IAM</b><br>supra &amp; infra'), '**IAM**\nsupra & infra');
  assert.equal(detectSeparator('x|y\nz|w'), 'pipe');
});

const NOW = new Date(2026, 10, 11, 15, 0).getTime();
const key = (offset) => keyFromNumber(dayNumber(NOW) + offset);

test('sequência de dias, recorde e acertos', () => {
  const days = byDay([
    { day: key(-1), reviews: 10, revAnswers: 8, revCorrect: 6 },
    { day: key(-2), reviews: 5, revAnswers: 2, revCorrect: 2 },
    { day: key(-2), reviews: 3 }, // outro aparelho no mesmo dia
    { day: key(-5), reviews: 1 },
  ]);
  assert.equal(days.get(key(-2)).reviews, 8);
  assert.deepEqual(streak(days, NOW), { current: 2, studiedToday: false });
  assert.equal(bestStreak(days), 2);
  assert.deepEqual(retention(days, 30, NOW), { pct: 80, answers: 10 });
  assert.equal(lastDays(days, 7, NOW).length, 7);
});

test('contagem por fase e previsão', () => {
  const notes = [
    { id: 'a', deckId: 'd', type: 'basic', front: 'a', back: 'b' },
    { id: 'b', deckId: 'd', type: 'reverse', front: 'a', back: 'b' },
  ];
  const cards = {
    'b~0': { state: 'review', ivl: 30, due: dayStart(dayNumber(NOW) + 2) },
    'b~1': { state: 'learning', ivl: 0, due: NOW - 1000 },
  };
  assert.deepEqual(cardCounts(notes, cards), { new: 1, learning: 1, young: 0, mature: 1, total: 3 });
  const f = forecast(notes, cards, 7, NOW);
  assert.equal(f[0].count, 1);
  assert.equal(f[2].count, 1);
});
