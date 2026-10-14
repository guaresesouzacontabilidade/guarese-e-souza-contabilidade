// Receitas, despesas, carteiras e orçamento.
import { sumBy } from './money.js';
import { startOfMonth, endOfMonth, diffDays, addDays } from './dates.js';
import { matchesQuery, normalize } from './text.js';
import { findCategory } from './categories.js';

export const WALLET_TYPES = [
  { id: 'bank', label: 'Conta bancária', short: 'Banco', icon: 'landmark' },
  { id: 'cash', label: 'Dinheiro', short: 'Dinheiro', icon: 'banknote' },
  { id: 'card', label: 'Cartão', short: 'Cartão', icon: 'credit-card' },
];

export const walletType = (id) => WALLET_TYPES.find((t) => t.id === id) || WALLET_TYPES[0];

export const live = (list) => list.filter((x) => !x.deleted);

export function inPeriod(transactions, from, to) {
  return transactions.filter((t) => !t.deleted && t.date >= from && t.date <= to);
}

export function totals(transactions, from, to) {
  const list = inPeriod(transactions, from, to);
  const income = sumBy(list.filter((t) => t.type === 'income'), (t) => t.amount);
  const expense = sumBy(list.filter((t) => t.type === 'expense'), (t) => t.amount);
  return { income, expense, balance: income - expense, count: list.length, list };
}

export function monthTotals(transactions, anyDayInMonth) {
  return totals(transactions, startOfMonth(anyDayInMonth), endOfMonth(anyDayInMonth));
}

export function walletBalance(wallet, transactions) {
  const own = transactions.filter((t) => !t.deleted && t.walletId === wallet.id);
  return (wallet.initialBalance || 0) + sumBy(own, (t) => (t.type === 'income' ? t.amount : -t.amount));
}

export function walletsTotal(wallets, transactions) {
  return sumBy(live(wallets), (w) => walletBalance(w, transactions));
}

// Orçamento do mês: quanto já foi usado, quanto resta e quanto dá por dia.
export function budgetStatus(budget, spent, today) {
  if (!budget || budget <= 0) return null;
  const end = endOfMonth(today);
  const daysLeft = diffDays(today, end) + 1;
  const daysInMonth = Number(end.slice(8, 10));
  const dayOfMonth = Number(today.slice(8, 10));
  const remaining = budget - spent;
  const ratio = spent / budget;
  const expectedRatio = dayOfMonth / daysInMonth;
  let level = 'ok';
  if (ratio >= 1) level = 'over';
  else if (ratio >= 0.85 || ratio > expectedRatio + 0.15) level = 'attention';
  return {
    budget,
    spent,
    remaining,
    ratio,
    daysLeft,
    perDay: remaining > 0 ? Math.floor(remaining / daysLeft) : 0,
    level,
    expectedRatio,
  };
}

export function budgetMessage(status) {
  if (!status) return '';
  if (status.level === 'over') return 'Você passou do orçamento deste mês.';
  if (status.level === 'attention') return status.ratio >= 0.85 ? 'Atenção: o orçamento está quase no fim.' : 'Os gastos estão um pouco acima do ritmo do mês.';
  return 'Tudo dentro do planejado.';
}

export function byCategory(transactions, type, custom = []) {
  const map = new Map();
  for (const t of transactions) {
    if (t.deleted || t.type !== type) continue;
    const id = t.category || 'sem-categoria';
    const entry = map.get(id) || { id, total: 0, count: 0, items: [] };
    entry.total += t.amount;
    entry.count++;
    entry.items.push(t);
    map.set(id, entry);
  }
  const grand = sumBy([...map.values()], (e) => e.total);
  return [...map.values()]
    .map((e) => ({
      ...e,
      category: e.id === 'sem-categoria' ? { id: e.id, label: 'Sem categoria', icon: 'tag' } : findCategory(e.id, type, custom),
      share: grand ? e.total / grand : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function searchTransactions(transactions, query, { type = 'all', category = 'all', walletId = 'all', from, to } = {}, custom = []) {
  return transactions
    .filter((t) => !t.deleted)
    .filter((t) => type === 'all' || t.type === type)
    .filter((t) => category === 'all' || t.category === category)
    .filter((t) => walletId === 'all' || t.walletId === walletId)
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .filter((t) => matchesQuery([t.description, t.notes, findCategory(t.category, t.type, custom).label, String(t.amount / 100).replace('.', ',')], query))
    .sort(compareTransactions);
}

export function compareTransactions(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

export function groupByDate(transactions) {
  const groups = [];
  let current = null;
  for (const t of [...transactions].sort(compareTransactions)) {
    if (!current || current.date !== t.date) {
      current = { date: t.date, items: [], income: 0, expense: 0 };
      groups.push(current);
    }
    current.items.push(t);
    current[t.type] += t.amount;
  }
  return groups;
}

// Procura lançamentos parecidos para evitar registro em dobro (mesmo tipo e valor, datas próximas).
export function findPossibleDuplicates(transactions, { type, amount, date, description, excludeId, windowDays = 5 }) {
  const desc = normalize(description);
  const firstWord = desc.split(' ').find((w) => w.length >= 3);
  return transactions
    .filter((t) => !t.deleted && t.id !== excludeId && t.type === type && t.amount === amount)
    .map((t) => ({ t, distance: Math.abs(diffDays(t.date, date)) }))
    .filter(({ t, distance }) => distance <= windowDays || (firstWord && normalize(t.description).includes(firstWord) && distance <= 20))
    .sort((a, b) => a.distance - b.distance)
    .map(({ t }) => t);
}

export function lastNDays(today, n) {
  return { from: addDays(today, -(n - 1)), to: today };
}
