import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as d from '../../js/core/dates.js';
import { formatMoney, parseMoney, digitsToCents } from '../../js/core/money.js';
import { occurrencesBetween, nextOccurrence } from '../../js/core/recurrence.js';
import { occurrencesOnDay, overdueTasks, todayAgenda, searchAgenda, isDoneOn } from '../../js/core/agenda.js';
import { totals, walletBalance, budgetStatus, byCategory, searchTransactions, findPossibleDuplicates, groupByDate } from '../../js/core/finance.js';
import { billState, groupBills, planPayment, upcomingForHome, nextBillDue } from '../../js/core/bills.js';
import { suggestCategory } from '../../js/core/categories.js';
import { dueReminders } from '../../js/core/reminders.js';
import { comparePeriods, periodLabel, previousPeriod, monthlySeries } from '../../js/core/reports.js';
import { normalize, matchesQuery } from '../../js/core/text.js';

const TODAY = '2026-10-14'; // quarta-feira

test('datas: soma de meses respeita o fim do mês', () => {
  assert.equal(d.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(d.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(d.addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(d.addMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(d.addYears('2024-02-29', 1), '2025-02-28');
});

test('datas: semana começa no domingo', () => {
  assert.equal(d.startOfWeek(TODAY), '2026-10-11');
  assert.equal(d.endOfWeek(TODAY), '2026-10-17');
  assert.equal(d.weekday('2026-10-11'), 0);
});

test('datas: textos em português', () => {
  assert.equal(d.formatLongDate(TODAY), 'quarta-feira, 14 de outubro');
  assert.equal(d.formatNumeric(TODAY), '14/10/2026');
  assert.equal(d.relativeDay('2026-10-15', TODAY), 'amanhã');
  assert.equal(d.relativeDay('2026-10-13', TODAY), 'ontem');
  assert.equal(d.dueLabel('2026-10-14', TODAY), 'vence hoje');
  assert.equal(d.dueLabel('2026-10-10', TODAY), 'venceu há 4 dias');
  assert.equal(d.dueLabel('2026-10-19', TODAY), 'vence em 5 dias');
  assert.equal(d.diffDays('2026-03-07', '2026-03-09'), 2); // atravessa mudança de horário em alguns fusos
  assert.equal(d.isValidISODate('2026-02-30'), false);
  assert.equal(d.isValidISODate('2026-02-28'), true);
});

test('dinheiro: formata e interpreta reais', () => {
  assert.equal(formatMoney(123456), 'R$ 1.234,56');
  assert.equal(formatMoney(-5000), '-R$ 50,00');
  assert.equal(formatMoney(5000, { signed: true }), '+R$ 50,00');
  assert.equal(parseMoney('1.234,56'), 123456);
  assert.equal(parseMoney('R$ 12'), 1200);
  assert.equal(parseMoney('12,5'), 1250);
  assert.equal(parseMoney('12.50'), 1250);
  assert.equal(parseMoney('1.000'), 100000);
  assert.equal(parseMoney('abc'), null);
  assert.equal(digitsToCents('R$ 1.234,5'), 12345);
  assert.equal(digitsToCents(''), 0);
});

test('texto: busca ignora acentos e maiúsculas', () => {
  assert.equal(normalize('  Combustível  JÁ! '), 'combustivel ja');
  assert.ok(matchesQuery(['Reunião com Ana'], 'reuniao ana'));
  assert.ok(!matchesQuery(['Reunião com Ana'], 'pedro'));
});

test('repetição: semanal, mensal e anual', () => {
  const weekly = { date: '2026-10-01', repeat: 'weekly' };
  assert.deepEqual(occurrencesBetween(weekly, '2026-10-10', '2026-10-31'), ['2026-10-15', '2026-10-22', '2026-10-29']);
  const monthly = { date: '2026-01-31', repeat: 'monthly' };
  assert.deepEqual(occurrencesBetween(monthly, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  const yearly = { date: '1990-05-20', repeat: 'yearly' };
  assert.deepEqual(occurrencesBetween(yearly, '2026-01-01', '2026-12-31'), ['2026-05-20']);
  const skipped = { date: '2026-10-01', repeat: 'weekly', skipDates: ['2026-10-15'] };
  assert.deepEqual(occurrencesBetween(skipped, '2026-10-10', '2026-10-23'), ['2026-10-22']);
  assert.equal(nextOccurrence(monthly, '2026-03-01'), '2026-03-31');
  assert.deepEqual(occurrencesBetween({ date: '2026-10-20', repeat: 'none' }, '2026-10-01', '2026-10-31'), ['2026-10-20']);
});

const events = [
  { id: 'a', kind: 'event', title: 'Dentista', date: TODAY, time: '15:00', repeat: 'none' },
  { id: 'b', kind: 'task', title: 'Pagar escola', date: TODAY, repeat: 'none', done: false },
  { id: 'c', kind: 'task', title: 'Academia', date: '2026-10-07', repeat: 'weekly', doneDates: ['2026-10-14'] },
  { id: 'd', kind: 'task', title: 'Ligar para o banco', date: '2026-10-10', repeat: 'none', done: false },
  { id: 'e', kind: 'event', title: 'Reunião cedo', date: TODAY, time: '08:00', repeat: 'none' },
  { id: 'f', kind: 'event', title: 'Apagado', date: TODAY, time: '10:00', repeat: 'none', deleted: true },
];

test('agenda: itens do dia, ordem e conclusão por ocorrência', () => {
  const day = occurrencesOnDay(events, TODAY);
  assert.deepEqual(day.map((o) => o.item.id), ['c', 'b', 'e', 'a']);
  assert.equal(day.find((o) => o.item.id === 'c').done, true);
  assert.equal(isDoneOn(events[2], '2026-10-21'), false);
  assert.deepEqual(overdueTasks(events, TODAY).map((o) => o.item.id), ['d']);
});

test('agenda: hoje separa o que já passou', () => {
  const { upcoming, finished } = todayAgenda(events, TODAY, '12:00');
  assert.deepEqual(upcoming.map((o) => o.item.id), ['b', 'a']);
  assert.deepEqual(finished.map((o) => o.item.id).sort(), ['c', 'e']);
});

test('agenda: busca e filtros', () => {
  assert.deepEqual(searchAgenda(events, 'dentista').map((e) => e.id), ['a']);
  assert.deepEqual(searchAgenda(events, '', { kind: 'task', status: 'pending' }).map((e) => e.id).sort(), ['b', 'c', 'd']);
});

const wallets = [{ id: 'w1', name: 'Nubank', type: 'bank', initialBalance: 100000 }];
const txs = [
  { id: 't1', type: 'income', amount: 500000, description: 'Salário', date: '2026-10-05', category: 'salario', walletId: 'w1' },
  { id: 't2', type: 'expense', amount: 20000, description: 'Posto Shell', date: '2026-10-02', category: 'combustivel', walletId: 'w1' },
  { id: 't3', type: 'expense', amount: 15000, description: 'Gasolina', date: '2026-10-12', category: 'combustivel' },
  { id: 't4', type: 'expense', amount: 150000, description: 'Aluguel', date: '2026-10-05', category: 'moradia', walletId: 'w1' },
  { id: 't5', type: 'expense', amount: 30000, description: 'Mercado', date: '2026-09-20', category: 'mercado' },
  { id: 't6', type: 'expense', amount: 99900, description: 'Excluído', date: '2026-10-03', deleted: true },
];

test('finanças: totais do mês ignoram excluídos', () => {
  const t = totals(txs, '2026-10-01', '2026-10-31');
  assert.equal(t.income, 500000);
  assert.equal(t.expense, 185000);
  assert.equal(t.balance, 315000);
  assert.equal(t.count, 4);
});

test('finanças: saldo da carteira', () => {
  assert.equal(walletBalance(wallets[0], txs), 100000 + 500000 - 20000 - 150000);
});

test('finanças: orçamento', () => {
  const s = budgetStatus(300000, 120000, TODAY);
  assert.equal(s.remaining, 180000);
  assert.equal(s.daysLeft, 18);
  assert.equal(s.perDay, 10000);
  assert.equal(s.level, 'ok');
  // 62% usado no dia 14 de 31: acima do ritmo do mês.
  assert.equal(budgetStatus(300000, 185000, TODAY).level, 'attention');
  assert.equal(budgetStatus(100000, 120000, TODAY).level, 'over');
  assert.equal(budgetStatus(0, 100, TODAY), null);
});

test('finanças: por categoria, busca, agrupamento', () => {
  const cats = byCategory(totals(txs, '2026-10-01', '2026-10-31').list, 'expense');
  assert.equal(cats[0].id, 'moradia');
  assert.equal(cats[1].total, 35000);
  assert.deepEqual(searchTransactions(txs, 'combustivel').map((t) => t.id), ['t3', 't2']);
  assert.deepEqual(searchTransactions(txs, 'gasolina').map((t) => t.id), ['t3']);
  assert.equal(groupByDate(txs.filter((t) => !t.deleted))[0].date, '2026-10-12');
});

test('finanças: detecta possível lançamento duplicado', () => {
  const dup = findPossibleDuplicates(txs, { type: 'expense', amount: 150000, date: '2026-10-07', description: 'Aluguel outubro' });
  assert.deepEqual(dup.map((t) => t.id), ['t4']);
  assert.equal(findPossibleDuplicates(txs, { type: 'expense', amount: 150001, date: '2026-10-07', description: 'x' }).length, 0);
});

test('categorias: sugestão por palavra-chave e por histórico', () => {
  assert.equal(suggestCategory('Gasolina do carro', 'expense'), 'combustivel');
  assert.equal(suggestCategory('iFood sábado', 'expense'), 'alimentacao');
  assert.equal(suggestCategory('Conta de luz', 'expense'), 'moradia');
  assert.equal(suggestCategory('Salário outubro', 'income'), 'salario');
  const history = [{ type: 'expense', description: 'Padaria do Zé', category: 'mercado', updatedAt: 1 }];
  assert.equal(suggestCategory('padaria do ze', 'expense', history), 'mercado');
  assert.equal(suggestCategory('xyz', 'expense'), null);
});

const bills = [
  { id: 'b1', kind: 'pay', description: 'Luz', amount: 18000, dueDate: '2026-10-10', status: 'open', repeat: 'monthly', remind: [1, 0] },
  { id: 'b2', kind: 'pay', description: 'Internet', amount: 10000, dueDate: '2026-10-16', status: 'open', repeat: 'none', remind: [1] },
  { id: 'b3', kind: 'pay', description: 'IPVA', amount: 90000, dueDate: '2026-11-30', status: 'open', repeat: 'none', remind: [] },
  { id: 'b4', kind: 'pay', description: 'Água', amount: 8000, dueDate: '2026-10-05', status: 'paid', paidAt: '2026-10-05', repeat: 'none' },
  { id: 'b5', kind: 'receive', description: 'Cliente X', amount: 50000, dueDate: '2026-10-20', status: 'open', repeat: 'none' },
];

test('contas: situação e agrupamento', () => {
  assert.equal(billState(bills[0], TODAY), 'overdue');
  assert.equal(billState(bills[1], TODAY), 'soon');
  assert.equal(billState(bills[2], TODAY), 'upcoming');
  assert.equal(billState(bills[3], TODAY), 'paid');
  const g = groupBills(bills, 'pay', TODAY);
  assert.deepEqual([g.overdue.length, g.soon.length, g.upcoming.length, g.paid.length], [1, 1, 1, 1]);
  assert.deepEqual(upcomingForHome(bills, TODAY).map((b) => b.id), ['b1', 'b2', 'b5']);
});

test('contas: pagar recorrente cria a próxima sem duplicar', () => {
  const { patch, next } = planPayment(bills[0], { date: TODAY }, bills);
  assert.equal(patch.status, 'paid');
  assert.equal(patch.paidAt, TODAY);
  assert.equal(patch.paidAmount, 18000);
  assert.equal(next.dueDate, '2026-11-10');
  assert.equal(next.seriesId, 'b1');
  assert.equal(next.generatedFrom, 'b1');
  const withNext = [...bills, { ...next, id: 'n1' }];
  assert.equal(planPayment(bills[0], { date: TODAY }, withNext).next, null);
  assert.equal(planPayment(bills[1], { date: TODAY }, bills).next, null);
});

test('contas: série mensal no dia 31 não "encolhe"', () => {
  const b = { id: 'x', dueDate: '2026-02-28', seriesStart: '2026-01-31', repeat: 'monthly' };
  assert.equal(nextBillDue(b), '2026-03-31');
});

test('lembretes: contas e compromissos no horário certo', () => {
  const settings = { reminderTime: '09:00' };
  const from = d.toTimestamp('2026-10-15', '08:00');
  const to = d.toTimestamp('2026-10-15', '10:00');
  const list = dueReminders({ events: [], bills, settings }, from, to);
  assert.deepEqual(list.map((r) => r.key), [`bill:b2:${d.toTimestamp('2026-10-15', '09:00')}`]);
  assert.match(list[0].title, /Internet vence amanhã/);

  const evs = [{ id: 'e1', kind: 'event', title: 'Dentista', date: '2026-10-15', time: '15:00', reminder: 30, repeat: 'none' }];
  const r = dueReminders({ events: evs, bills: [], settings }, d.toTimestamp('2026-10-15', '14:00'), d.toTimestamp('2026-10-15', '14:45'));
  assert.equal(r.length, 1);
  assert.equal(r[0].fireAt, d.toTimestamp('2026-10-15', '14:30'));

  // Remarcado para mais tarde: novo lembrete com outra chave.
  const moved = [{ ...evs[0], time: '16:00' }];
  const r2 = dueReminders({ events: moved, bills: [], settings }, d.toTimestamp('2026-10-15', '15:00'), d.toTimestamp('2026-10-15', '15:45'));
  assert.equal(r2.length, 1);
  assert.notEqual(r2[0].key, r[0].key);
});

test('pagamento não é vinculado a lançamento de outra conta', () => {
  const list = [
    { id: 'old', type: 'expense', amount: 15000, description: 'Diarista', date: '2026-10-07', billId: 'semana1' },
    { id: 'free', type: 'expense', amount: 15000, description: 'Diarista', date: '2026-10-13' },
  ];
  const base = { type: 'expense', amount: 15000, date: TODAY, description: 'Diarista' };
  assert.deepEqual(findPossibleDuplicates(list, base).map((t) => t.id), ['free', 'old']);
  assert.deepEqual(findPossibleDuplicates(list, { ...base, unlinkedOnly: true, linkedIds: new Set() }).map((t) => t.id), ['free']);
  assert.deepEqual(findPossibleDuplicates(list, { ...base, unlinkedOnly: true, linkedIds: new Set(['free']) }), []);
});

test('relatórios: períodos e rótulos', () => {
  assert.equal(periodLabel('2026-10-01', '2026-10-31'), 'outubro de 2026');
  assert.equal(periodLabel('2026-08-01', '2026-10-31'), 'agosto a outubro de 2026');
  assert.equal(periodLabel('2026-01-01', '2026-12-31'), 'ano de 2026');
  assert.equal(periodLabel('2026-10-01', '2026-10-14'), '1 a 14 de outubro de 2026');
  assert.deepEqual(previousPeriod('2026-10-01', '2026-10-31'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(previousPeriod('2026-08-01', '2026-10-31'), { from: '2026-05-01', to: '2026-07-31' });
});

test('relatórios: comparação justa com mês em andamento', () => {
  const list = [
    { id: '1', type: 'expense', amount: 10000, date: '2026-10-03', category: 'lazer', description: 'Cinema' },
    { id: '2', type: 'expense', amount: 20000, date: '2026-09-03', category: 'lazer', description: 'Show' },
    { id: '3', type: 'expense', amount: 50000, date: '2026-09-25', category: 'mercado', description: 'Mercado' },
  ];
  const c = comparePeriods(list, '2026-10-01', '2026-10-31', TODAY);
  assert.equal(c.partial, true);
  assert.deepEqual(c.prev, { from: '2026-09-01', to: '2026-09-14' });
  assert.equal(c.prevTotals.expense, 20000);
  assert.match(c.sentences[0], /^Até agora, você gastou R\$\s100,00 a menos que no mesmo período de setembro \(-50%\)\.$/);
  const closed = comparePeriods(list, '2026-09-01', '2026-09-30', TODAY);
  assert.equal(closed.partial, false);
  assert.match(closed.sentences[0], /Não há despesas registradas em agosto/);
});

test('relatórios: série mensal', () => {
  const s = monthlySeries(txs, '2026-09-01', '2026-10-31');
  assert.deepEqual(s.map((m) => m.label), ['set', 'out']);
  assert.equal(s[0].expense, 30000);
  assert.equal(s[1].income, 500000);
});
