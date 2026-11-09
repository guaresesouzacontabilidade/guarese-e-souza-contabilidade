// Parcelas, regras de categoria, previsão do fim do mês e limites por categoria.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitAmount, planInstallments, activePlans, upcomingByMonth, groupItems } from '../../js/core/installments.js';
import { ruleKey, learnRule, findRule, suggestCategory } from '../../js/core/categories.js';
import { monthForecast, billsUntil } from '../../js/core/forecast.js';
import { categoryLimits, limitWarning, walletBalance } from '../../js/core/finance.js';
import { parseStatementText } from '../../js/core/statement.js';
import { parseQuickEntry } from '../../js/core/quickEntry.js';
import { ask } from '../../js/core/assistant.js';

const TODAY = '2026-10-14';
let seq = 0;
const tx = (o) => ({ id: `t${++seq}`, type: 'expense', category: null, deleted: false, ...o });

test('parcelas: divide em centavos sem perder nenhum', () => {
  assert.deepEqual(splitAmount(100000, 3), [33334, 33333, 33333]);
  assert.deepEqual(splitAmount(30000, 10), Array(10).fill(3000));
});

test('parcelas: uma por mês, a partir da primeira, sem encolher o dia', () => {
  const list = planInstallments({ type: 'expense', amount: 300000, description: 'Geladeira', date: '2026-01-31' }, { count: 4, group: 'g1' });
  assert.deepEqual(list.map((t) => t.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(list.map((t) => t.installment.n), [1, 2, 3, 4]);
  assert.ok(list.every((t) => t.installment.of === 4 && t.installment.total === 300000 && t.installment.group === 'g1'));
  // Valor de cada parcela: total = parcela × quantidade.
  const each = planInstallments({ type: 'expense', amount: 4990, description: 'Fone', date: TODAY }, { count: 3, perInstallment: true, group: 'g2' });
  assert.deepEqual(each.map((t) => t.amount), [4990, 4990, 4990]);
  assert.equal(each[0].installment.total, 14970);
});

test('parcelas: o que falta e quanto já está comprometido nos próximos meses', () => {
  const items = planInstallments({ type: 'expense', amount: 3000, description: 'Tênis', date: '2026-09-20', walletId: 'w1' }, { count: 3, perInstallment: true, group: 'g' }).map(tx);
  const plans = activePlans(items, TODAY);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].posted, 1); // só a de setembro já passou
  assert.equal(plans[0].remainingCount, 2);
  assert.equal(plans[0].remaining, 6000);
  assert.equal(plans[0].next.date, '2026-10-20');
  const months = upcomingByMonth(items, TODAY, 3);
  assert.deepEqual(months.map((m) => [m.month, m.total]), [['2026-11-01', 3000], ['2026-12-01', 0], ['2027-01-01', 0]]);
  // Parcelas futuras não mexem no saldo da carteira hoje.
  assert.equal(walletBalance({ id: 'w1', initialBalance: 10000 }, items, TODAY), 7000);
  assert.equal(walletBalance({ id: 'w1', initialBalance: 10000 }, items), 1000);
  // Excluir uma parcela tira ela da compra.
  items[2].deleted = true;
  assert.equal(groupItems(items, 'g').length, 2);
  assert.equal(activePlans(items, TODAY)[0].remaining, 3000);
});

test('regras: reconhece a loja mesmo com o texto do banco', () => {
  assert.equal(ruleKey('UBER *TRIP HELP.UBER.COM'), 'uber');
  assert.equal(ruleKey('IFD*IFOOD CLUB'), 'ifood');
  assert.equal(ruleKey('COMPRA CARTAO DEB MC POSTO SHELL 123'), 'posto shell');
  assert.equal(ruleKey('PIX ENVIADO JOAO SILVA'), 'joao silva');
  assert.equal(ruleKey('NETFLIX.COM'), 'netflix');
  assert.equal(ruleKey('12/10 1234'), null);
});

test('regras: aprende com a correção e vale para as próximas', () => {
  let { rules, rule } = learnRule([], { description: 'UBER *TRIP 1234', type: 'expense', category: 'transporte', id: 'r1' });
  assert.deepEqual(rule, { id: 'r1', type: 'expense', match: 'uber', category: 'transporte' });
  assert.equal(suggestCategory('UBER* PENDING SAO PAULO', 'expense', [], [], rules), 'transporte');
  // Palavra inteira: "Uberlândia" não é Uber.
  assert.equal(findRule('Hotel Uberlândia', 'expense', rules), null);
  // Mesma regra, nova categoria: atualiza em vez de duplicar.
  ({ rules, rule } = learnRule(rules, { description: 'Uber', type: 'expense', category: 'trabalho', id: 'r2' }));
  assert.equal(rules.length, 1);
  assert.equal(rule.category, 'trabalho');
  // Nada muda se a categoria já era essa.
  assert.equal(learnRule(rules, { description: 'UBER', type: 'expense', category: 'trabalho', id: 'r3' }).rule, null);
  // Regra mais específica ganha.
  rules = [...rules, { id: 'r4', type: 'expense', match: 'posto shell', category: 'combustivel' }, { id: 'r5', type: 'expense', match: 'posto', category: 'outros' }];
  assert.equal(findRule('POSTO SHELL 22', 'expense', rules).id, 'r4');
});

test('regras: valem na importação de extrato e na voz', () => {
  const rules = [{ id: 'r', type: 'expense', match: 'padaria pao', category: 'mercado' }];
  const { rows } = parseStatementText('10/10/2026 PADARIA PAO QUENTE 25,90 D', { today: TODAY, mode: 'bank', history: [], rules });
  assert.equal(rows[0].category, 'mercado');
  assert.equal(parseQuickEntry('gastei 12 reais na padaria pão quente', TODAY, [], rules).category, 'mercado');
});

test('previsão: saldo do mês mais o que ainda vai entrar e sair', () => {
  const transactions = [
    tx({ type: 'income', amount: 500000, date: '2026-10-05', description: 'Salário' }),
    tx({ amount: 120000, date: '2026-10-08', description: 'Mercado' }),
    tx({ amount: 30000, date: '2026-10-25', description: 'Geladeira', installment: { group: 'g', n: 2, of: 10, total: 300000 } }),
  ];
  const bills = [
    { id: 'b1', kind: 'pay', description: 'Aluguel', amount: 150000, dueDate: '2026-10-20', status: 'open' },
    { id: 'b2', kind: 'pay', description: 'Luz', amount: 20000, dueDate: '2026-10-02', status: 'open' }, // vencida
    { id: 'b3', kind: 'receive', description: 'Freela', amount: 80000, dueDate: '2026-10-30', status: 'open' },
    { id: 'b4', kind: 'pay', description: 'Escola', amount: 70000, dueDate: '2026-11-05', status: 'open' }, // mês que vem
    { id: 'b5', kind: 'pay', description: 'Internet', amount: 10000, dueDate: '2026-10-10', status: 'paid' },
  ];
  const f = monthForecast({ transactions, bills }, TODAY);
  assert.equal(f.balance, 500000 - 120000 - 30000);
  assert.equal(f.toPay, 170000);
  assert.equal(f.toReceive, 80000);
  assert.equal(f.forecast, 350000 + 80000 - 170000);
  assert.equal(f.overdueCount, 1);
  assert.equal(f.scheduledCount, 1);
  assert.equal(f.date, '2026-10-31');
  assert.ok(f.hasPending);
});

test('previsão: conta semanal entra quantas vezes ainda vence no mês', () => {
  const bills = [{ id: 'd', kind: 'pay', description: 'Diarista', amount: 15000, dueDate: '2026-10-16', status: 'open', repeat: 'weekly' }];
  assert.deepEqual(billsUntil(bills, '2026-10-31').map((x) => x.dueDate), ['2026-10-16', '2026-10-23', '2026-10-30']);
  // Se a próxima já existe como conta, não conta duas vezes.
  const withNext = [...bills, { id: 'e', seriesId: 'd', kind: 'pay', description: 'Diarista', amount: 15000, dueDate: '2026-10-23', status: 'open', repeat: 'weekly' }];
  assert.equal(billsUntil(withNext, '2026-10-31').length, 3);
});

test('limites por categoria: quanto foi usado e quando avisar', () => {
  const transactions = [tx({ amount: 62000, category: 'mercado', date: '2026-10-03' }), tx({ amount: 9000, category: 'mercado', date: '2026-09-30' }), tx({ amount: 35000, category: 'lazer', date: '2026-10-10' })];
  const list = categoryLimits({ mercado: 80000, lazer: 30000, pets: 0 }, transactions, TODAY);
  // Mercado: 77% usado no dia 14 — acima do ritmo do mês, então pede atenção.
  assert.deepEqual(list.map((l) => [l.id, l.spent, l.level]), [['lazer', 35000, 'over'], ['mercado', 62000, 'attention']]);
  assert.equal(list[1].category.label, 'Mercado');
  assert.equal(limitWarning(80000, 62000, 66000), 'near');
  assert.equal(limitWarning(80000, 66000, 70000), null);
  assert.equal(limitWarning(80000, 70000, 80000), 'over');
  assert.equal(limitWarning(80000, 90000, 95000), null);
  assert.equal(limitWarning(0, 0, 5000), null);
});

test('assistente: previsão, parcelas e limite de uma categoria', () => {
  const transactions = [
    tx({ type: 'income', amount: 500000, date: '2026-10-05', description: 'Salário', category: 'salario' }),
    tx({ amount: 62000, date: '2026-10-08', description: 'Mercado', category: 'mercado' }),
    ...planInstallments({ type: 'expense', amount: 300000, description: 'Geladeira', date: '2026-09-25', category: 'compras' }, { count: 10, group: 'g' }).map(tx),
  ];
  const bills = [{ id: 'b1', kind: 'pay', description: 'Aluguel', amount: 150000, dueDate: '2026-10-20', status: 'open' }];
  const ctx = { today: TODAY, transactions, bills, wallets: [], events: [], settings: { budget: 0, categoryBudgets: { mercado: 80000 } } };

  const f = ask('Como vou terminar o mês?', ctx);
  assert.match(f.text, /previsão/i);
  assert.match(f.text, /R\$\s2\.580,00/); // 5.000 − 620 − 300 (parcela de 25/10) − 1.500 (aluguel)
  assert.ok(f.steps.some((s) => /Aluguel/.test(s) || /a pagar/.test(s)));

  const p = ask('Quanto falta pagar de parcelas?', ctx);
  assert.match(p.text, /R\$\s2\.700,00/); // 9 parcelas de 300 depois de hoje (25/10 a 25/06)
  assert.ok(p.items.some((i) => /Geladeira/.test(i)));

  const l = ask('Quanto ainda posso gastar com mercado?', ctx);
  assert.match(l.text, /R\$\s180,00/);
  assert.match(l.text, /Mercado/);

  const none = ask('Quanto posso gastar com lazer?', ctx);
  assert.match(none.text, /não definiu um limite para Lazer/);
});

test('assistente: não confunde perguntas parecidas', () => {
  const ctx = { today: TODAY, transactions: [tx({ amount: 1000, date: '2026-10-02', description: 'Café', category: 'alimentacao' })], bills: [], wallets: [], events: [], settings: { budget: 100000, categoryBudgets: { mercado: 80000 } } };
  // Pergunta geral sobre o orçamento continua respondendo o orçamento do mês, mesmo com limites definidos.
  assert.match(ask('Quanto posso gastar no mês?', ctx).text, /no orçamento deste mês/);
  assert.match(ask('Como estão meus limites?', ctx).text, /dentro do limite/);
  // "Parcela" com "gastei" é pergunta de gasto; "fim do mês" na agenda é agenda.
  assert.doesNotMatch(ask('Quanto gastei com a parcela do carro?', ctx).text, /compras parceladas/);
  assert.doesNotMatch(ask('O que tenho na agenda até o fim do mês?', ctx).text, /previsão/i);
  assert.match(ask('Quanto vai sobrar no fim do mês?', ctx).text, /previsão/i);
});
