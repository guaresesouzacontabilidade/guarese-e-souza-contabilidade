// Compras parceladas: divide o valor, gera uma parcela por mês e resume o que ainda falta.
import { addMonths, startOfMonth, endOfMonth } from './dates.js';
import { sumBy } from './money.js';

export const MAX_INSTALLMENTS = 48;
export const INSTALLMENT_CHOICES = [2, 3, 4, 5, 6, 8, 10, 12, 18, 24];

// Divide o total em centavos. Os centavos que sobram ficam na primeira parcela (como fazem as lojas).
export function splitAmount(total, count) {
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? rest : 0));
}

// Gera os lançamentos das parcelas. `perInstallment`: o valor digitado é o de cada parcela.
// As datas contam sempre a partir da primeira (31/01 → 28/02 → 31/03), sem "encolher" o dia.
export function planInstallments(data, { count, perInstallment = false, group }) {
  const n = Math.max(2, Math.min(MAX_INSTALLMENTS, Math.round(count)));
  const amounts = perInstallment ? Array(n).fill(data.amount) : splitAmount(data.amount, n);
  const total = sumBy(amounts, (a) => a);
  return amounts.map((amount, i) => ({
    ...data,
    amount,
    date: addMonths(data.date, i),
    installment: { group, n: i + 1, of: n, total },
  }));
}

export const installmentText = (t) => (t?.installment ? `${t.installment.n}/${t.installment.of}` : '');

// Todas as parcelas (não excluídas) de uma compra, em ordem.
export function groupItems(transactions, group) {
  return transactions.filter((t) => !t.deleted && t.installment?.group === group).sort((a, b) => a.installment.n - b.installment.n);
}

// Compras que ainda têm parcelas com data depois de hoje.
export function activePlans(transactions, today) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.deleted || !t.installment) continue;
    const list = groups.get(t.installment.group) || [];
    list.push(t);
    groups.set(t.installment.group, list);
  }
  const plans = [];
  for (const [group, items] of groups) {
    items.sort((a, b) => a.installment.n - b.installment.n);
    const future = items.filter((t) => t.date > today);
    if (!future.length) continue;
    const first = items[0];
    plans.push({
      group,
      description: first.description,
      category: first.category,
      type: first.type,
      of: first.installment.of,
      total: first.installment.total,
      posted: items.length - future.length,
      remainingCount: future.length,
      remaining: sumBy(future, (t) => t.amount),
      next: future[0],
      last: future[future.length - 1],
      items,
    });
  }
  return plans.sort((a, b) => (a.next.date < b.next.date ? -1 : a.next.date > b.next.date ? 1 : 0));
}

// Quanto das despesas dos próximos meses já está comprometido com parcelas.
export function upcomingByMonth(transactions, today, months = 3) {
  const out = [];
  for (let i = 1; i <= months; i++) {
    const from = addMonths(startOfMonth(today), i);
    const to = endOfMonth(from);
    const list = transactions.filter((t) => !t.deleted && t.installment && t.type === 'expense' && t.date >= from && t.date <= to);
    out.push({ month: from, total: sumBy(list, (t) => t.amount), count: list.length });
  }
  return out;
}
