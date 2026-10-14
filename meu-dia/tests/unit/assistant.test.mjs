import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, parsePeriod, detectIntent, extractTerm } from '../../js/core/assistant.js';
import { normalize } from '../../js/core/text.js';

const TODAY = '2026-10-14';

const ctx = {
  today: TODAY,
  settings: { budget: 300000 },
  wallets: [{ id: 'w1', name: 'Nubank', type: 'bank', initialBalance: 100000 }],
  transactions: [
    { id: 't1', type: 'income', amount: 500000, description: 'Salário', date: '2026-10-05', category: 'salario', walletId: 'w1' },
    { id: 't2', type: 'expense', amount: 20000, description: 'Posto Shell', date: '2026-10-02', category: 'combustivel', walletId: 'w1' },
    { id: 't3', type: 'expense', amount: 15000, description: 'Gasolina', date: '2026-10-12', category: 'combustivel' },
    { id: 't4', type: 'expense', amount: 150000, description: 'Aluguel', date: '2026-10-05', category: 'moradia', walletId: 'w1' },
    { id: 't5', type: 'expense', amount: 30000, description: 'Mercado Extra', date: '2026-09-20', category: 'mercado' },
    { id: 't6', type: 'expense', amount: 4500, description: 'Uber centro', date: '2026-10-08', category: 'transporte' },
  ],
  bills: [
    { id: 'b1', kind: 'pay', description: 'Luz', amount: 18000, dueDate: '2026-10-10', status: 'open', repeat: 'monthly' },
    { id: 'b2', kind: 'pay', description: 'Internet', amount: 10000, dueDate: '2026-10-16', status: 'open', repeat: 'none' },
    { id: 'b3', kind: 'pay', description: 'Escola', amount: 70000, dueDate: '2026-10-17', status: 'open', repeat: 'none' },
    { id: 'b4', kind: 'pay', description: 'IPVA', amount: 90000, dueDate: '2026-11-30', status: 'open', repeat: 'none' },
    { id: 'b5', kind: 'pay', description: 'Água', amount: 8000, dueDate: '2026-10-15', status: 'paid', repeat: 'none' },
  ],
  events: [
    { id: 'e1', kind: 'event', title: 'Dentista', date: TODAY, time: '15:00', repeat: 'none' },
    { id: 'e2', kind: 'task', title: 'Comprar presente', date: '2026-10-15', repeat: 'none' },
  ],
};

const q = (text, c = ctx) => ask(text, c);
const brl = (s) => s.replace(/ /g, ' ');

test('intenções principais', () => {
  assert.equal(detectIntent(normalize('Quanto gastei este mês?')), 'spend');
  assert.equal(detectIntent(normalize('Quanto gastei com combustível?')), 'spend');
  assert.equal(detectIntent(normalize('Quais contas vencem esta semana?')), 'bills');
  assert.equal(detectIntent(normalize('Quanto ainda tenho no orçamento?')), 'budget');
  assert.equal(detectIntent(normalize('Qual foi meu maior gasto?')), 'biggest');
  assert.equal(detectIntent(normalize('Com o que mais gastei?')), 'categories');
  assert.equal(detectIntent(normalize('Gastei mais que no mês passado?')), 'compare');
  assert.equal(detectIntent(normalize('Paga a conta de luz pra mim')), 'action');
  assert.equal(detectIntent(normalize('O que tenho amanhã?')), 'agenda');
  assert.equal(detectIntent(normalize('Quanto recebi em setembro?')), 'income');
});

test('períodos em português', () => {
  assert.deepEqual(pick(parsePeriod('quanto gastei este mes', TODAY)), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(pick(parsePeriod('gastos do mes passado', TODAY)), ['2026-09-01', '2026-09-30']);
  assert.deepEqual(pick(parsePeriod('contas que vencem esta semana', TODAY)), ['2026-10-11', '2026-10-17']);
  assert.deepEqual(pick(parsePeriod('quanto gastei em setembro', TODAY)), ['2026-09-01', '2026-09-30']);
  assert.deepEqual(pick(parsePeriod('quanto gastei em dezembro', TODAY)), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(pick(parsePeriod('quanto gastei em marco de 2026', TODAY)), ['2026-03-01', '2026-03-31']);
  assert.deepEqual(pick(parsePeriod('nos ultimos 7 dias', TODAY)), ['2026-10-08', '2026-10-14']);
  assert.deepEqual(pick(parsePeriod('quanto gastei hoje', TODAY)), [TODAY, TODAY]);
  assert.equal(parsePeriod('quanto gastei', TODAY), null);
});

function pick(p) {
  return p && [p.from, p.to];
}

test('termo depois do verbo', () => {
  assert.equal(extractTerm('quanto gastei com combustivel', /\bgastei\b/), 'combustivel');
  assert.equal(extractTerm('quanto gastei no uber', /\bgastei\b/), 'uber');
  assert.equal(extractTerm('quanto gastei de mercado em', /\bgastei\b/), 'mercado');
  assert.equal(extractTerm('quanto gastei', /\bgastei\b/), '');
});

test('“Quanto gastei este mês?” soma as despesas e mostra o cálculo', () => {
  const r = q('Quanto gastei este mês?');
  assert.equal(r.kind, 'answer');
  assert.equal(brl(r.text), 'Este mês você gastou R$ 1.895,00.');
  assert.ok(r.steps.some((s) => s.includes('Somei 4 despesas')));
  assert.equal(r.items.length, 4);
  assert.equal(brl(r.total), 'Total: R$ 1.895,00');
});

test('“Quanto gastei com combustível?” filtra pela categoria', () => {
  const r = q('Quanto gastei com combustível?');
  assert.equal(brl(r.text), 'Este mês você gastou R$ 350,00 com Combustível.');
  assert.equal(r.items.length, 2);
  assert.match(r.extra, /18% de todas as despesas/);
});

test('termo livre procura na descrição', () => {
  const r = q('quanto gastei com uber?');
  assert.equal(brl(r.text), 'Este mês você gastou R$ 45,00 com “uber”.');
});

test('palavra de categoria sem lançamento com esse nome usa a categoria', () => {
  const r = q('quanto gastei com etanol?');
  assert.equal(brl(r.text), 'Este mês você gastou R$ 350,00 com Combustível.');
  assert.ok(r.steps.some((s) => s.includes('entendi “etanol” como Combustível')));
});

test('“Quais contas vencem esta semana?” lista só as em aberto', () => {
  const r = q('Quais contas vencem esta semana?');
  assert.equal(brl(r.text), 'Esta semana vencem 2 contas a pagar, somando R$ 800,00.');
  assert.equal(r.items.length, 2);
  assert.match(r.extra, /1 conta já está vencida/);
});

test('“Quanto ainda tenho no orçamento?” explica a conta', () => {
  const r = q('Quanto ainda tenho no orçamento?');
  assert.equal(brl(r.text), 'Você ainda tem R$ 1.105,00 no orçamento deste mês (usou 63%).');
  assert.ok(r.steps.some((s) => brl(s) === 'R$ 3.000,00 − R$ 1.895,00 = R$ 1.105,00'));
  assert.match(brl(r.extra), /3 contas a pagar até o fim do mês \(R\$ 980,00\)\. Pagando todas, sobram R\$ 125,00\./);
});

test('sem orçamento definido, avisa e oferece atalho', () => {
  const r = q('Quanto ainda tenho no orçamento?', { ...ctx, settings: {} });
  assert.equal(r.kind, 'no-data');
  assert.ok(r.action.route.includes('ajustes'));
});

test('“Qual foi meu maior gasto?”', () => {
  const r = q('Qual foi meu maior gasto?');
  assert.equal(brl(r.text), 'Seu maior gasto este mês foi “Aluguel”: R$ 1.500,00 em 5 de outubro.');
  assert.match(r.extra, /Moradia/);
});

test('comparação com o mês passado', () => {
  const r = q('Comparar com o mês passado');
  assert.equal(r.kind, 'answer');
  assert.match(r.text, /mesmo período de setembro/);
});

test('sem dados suficientes avisa em vez de inventar', () => {
  const empty = { ...ctx, transactions: [], bills: [], events: [] };
  assert.equal(q('Quanto gastei este mês?', empty).kind, 'no-data');
  assert.equal(q('Quais contas vencem esta semana?', empty).kind, 'no-data');
  const r = q('quanto gastei com pizza em setembro');
  assert.equal(r.kind, 'no-data');
  assert.match(r.text, /Não encontrei despesas com “pizza” nem na categoria Alimentação em setembro/);
});

test('não faz pagamentos nem transferências', () => {
  const r = q('pode pagar minha conta de luz?');
  assert.equal(r.kind, 'refuse');
  assert.match(r.text, /não faço pagamentos/);
});

test('saldo do mês e das carteiras', () => {
  const r = q('Qual o saldo do mês?');
  assert.equal(brl(r.text), 'Este mês sobraram R$ 3.105,00: você recebeu R$ 5.000,00 e gastou R$ 1.895,00.');
  const w = q('Quanto tenho nas carteiras?');
  assert.equal(brl(w.text), 'Somando suas carteiras, você tem R$ 4.300,00.');
});

test('agenda pelo assistente', () => {
  assert.equal(q('O que tenho hoje?').text, 'Hoje você tem 1 compromisso.');
  assert.equal(q('O que tenho amanhã?').text, 'Amanhã você tem 1 tarefa.');
});

test('pergunta desconhecida sugere exemplos', () => {
  const r = q('qual a capital da França?');
  assert.equal(r.kind, 'unknown');
  assert.ok(r.suggestions.length >= 3);
});
