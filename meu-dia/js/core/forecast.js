// Previsão do saldo do mês: o que já foi lançado + o que está marcado para acontecer até o fim do mês.
// Não inventa gastos: só usa lançamentos e contas que o usuário registrou.
import { startOfMonth, endOfMonth } from './dates.js';
import { sumBy } from './money.js';
import { totals } from './finance.js';
import { openBills, nextBillDue } from './bills.js';
import { isRecurring } from './recurrence.js';

// Contas em aberto até o fim do mês, incluindo as vencidas e as próximas repetições
// (ex.: conta semanal que ainda vai vencer mais duas vezes neste mês).
export function billsUntil(bills, to) {
  const out = [];
  const series = (b) => b.seriesId || b.id;
  const existing = new Set(bills.filter((b) => !b.deleted).map((b) => `${series(b)}|${b.dueDate}`));
  for (const bill of openBills(bills)) {
    if (bill.dueDate > to) continue;
    out.push({ bill, dueDate: bill.dueDate, amount: bill.amount, kind: bill.kind, projected: false });
    if (!isRecurring(bill)) continue;
    let current = bill;
    for (let i = 0; i < 40; i++) {
      const next = nextBillDue(current);
      if (!next || next > to) break;
      const key = `${series(bill)}|${next}`;
      if (!existing.has(key)) {
        existing.add(key);
        out.push({ bill, dueDate: next, amount: bill.amount, kind: bill.kind, projected: true });
      }
      current = { ...current, seriesStart: current.seriesStart || current.dueDate, dueDate: next };
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export function monthForecast({ transactions, bills }, today) {
  const from = startOfMonth(today);
  const to = endOfMonth(today);
  const month = totals(transactions, from, to);
  const scheduled = month.list.filter((t) => t.date > today);
  const due = billsUntil(bills, to);
  const pay = due.filter((d) => d.kind !== 'receive');
  const receive = due.filter((d) => d.kind === 'receive');
  const toPay = sumBy(pay, (d) => d.amount);
  const toReceive = sumBy(receive, (d) => d.amount);
  return {
    date: to,
    balance: month.balance,
    income: month.income,
    expense: month.expense,
    scheduledCount: scheduled.length,
    toPay,
    toReceive,
    pay,
    receive,
    overdueCount: pay.filter((d) => d.dueDate < today).length + receive.filter((d) => d.dueDate < today).length,
    forecast: month.balance + toReceive - toPay,
    // Só vale mostrar se há algo marcado para depois de hoje (senão a previsão é igual ao saldo).
    hasPending: due.length > 0 || scheduled.length > 0,
  };
}
