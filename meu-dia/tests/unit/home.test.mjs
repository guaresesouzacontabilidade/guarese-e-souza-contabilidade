// Resumo do dia, lançamentos frequentes e cores das categorias.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { daySummary } from '../../js/core/agenda.js';
import { frequentEntries } from '../../js/core/finance.js';
import { categoryHue, findCategory, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../js/core/categories.js';

const TODAY = '2026-10-14';
let seq = 0;
const ev = (o) => ({ id: `e${++seq}`, deleted: false, done: false, doneDates: [], skipDates: [], repeat: 'none', date: TODAY, ...o });
const tx = (o) => ({ id: `t${++seq}`, type: 'expense', deleted: false, ...o });

test('resumo do dia: tarefas, compromissos e contas de hoje', () => {
  const events = [
    ev({ kind: 'task', title: 'Ligar para o banco' }),
    ev({ kind: 'task', title: 'Mercado', done: true }),
    ev({ kind: 'event', title: 'Dentista', time: '15:00' }),
    ev({ kind: 'event', title: 'Café', time: '08:00' }), // já passou às 10:00
  ];
  const bills = [
    { id: 'b1', kind: 'pay', description: 'Luz', amount: 1, dueDate: TODAY, status: 'open' },
    { id: 'b2', kind: 'receive', description: 'Freela', amount: 1, dueDate: TODAY, status: 'open' },
    { id: 'b3', kind: 'pay', description: 'Água', amount: 1, dueDate: TODAY, status: 'paid' },
  ];
  assert.equal(daySummary(events, bills, TODAY, '10:00'), 'Hoje: 1 tarefa, 1 compromisso, 1 conta para pagar e 1 a receber.');
  assert.equal(daySummary([ev({ kind: 'task', title: 'X', done: true })], [], TODAY, '10:00'), 'Tudo feito por hoje.');
  assert.equal(daySummary([], [], TODAY, '10:00'), 'Nada marcado para hoje.');
});

test('frequentes: só o que se repete igual, sem parcelas, contas ou importados', () => {
  const list = [
    tx({ description: 'Café', amount: 800, date: '2026-10-01', category: 'alimentacao' }),
    tx({ description: 'café', amount: 800, date: '2026-10-10', category: 'alimentacao' }),
    tx({ description: 'Café', amount: 800, date: '2026-10-13', category: 'alimentacao' }),
    tx({ description: 'Ônibus', amount: 520, date: '2026-10-02', category: 'transporte' }),
    tx({ description: 'Ônibus', amount: 520, date: '2026-10-09', category: 'transporte' }),
    tx({ description: 'Mercado', amount: 12000, date: '2026-10-03' }), // valores diferentes
    tx({ description: 'Mercado', amount: 9800, date: '2026-10-08' }),
    tx({ description: 'Netflix', amount: 5590, date: '2026-09-15', importId: 'a' }),
    tx({ description: 'Netflix', amount: 5590, date: '2026-10-15', importId: 'b' }),
    tx({ description: 'Geladeira', amount: 30000, date: '2026-09-14', installment: { group: 'g', n: 1, of: 2 } }),
    tx({ description: 'Geladeira', amount: 30000, date: '2026-10-14', installment: { group: 'g', n: 2, of: 2 } }),
    tx({ description: 'Ônibus', amount: 520, date: '2026-05-01' }), // há mais de 90 dias
  ];
  const freq = frequentEntries(list, TODAY);
  assert.deepEqual(freq.map((f) => [f.description, f.amount, f.count]), [['Café', 800, 3], ['Ônibus', 520, 2]]);
  assert.equal(freq[0].category, 'alimentacao');
});

test('cores: cada categoria tem a sua, "Outros" fica neutro', () => {
  const hues = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map(categoryHue).filter((h) => h !== null);
  assert.equal(hues.length, EXPENSE_CATEGORIES.length + INCOME_CATEGORIES.length - 2);
  assert.equal(new Set(EXPENSE_CATEGORIES.map(categoryHue).filter((h) => h !== null)).size, EXPENSE_CATEGORIES.length - 1);
  assert.equal(categoryHue(findCategory('outros', 'expense')), null);
  assert.equal(categoryHue(findCategory(null, 'expense')), null);
  // Categoria criada pela pessoa: cor estável.
  const custom = { id: 'academia-x', label: 'Academia' };
  assert.equal(categoryHue(custom), categoryHue({ ...custom }));
  assert.ok(categoryHue(custom) >= 0 && categoryHue(custom) < 360);
});
