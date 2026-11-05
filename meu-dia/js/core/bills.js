// Contas a pagar e a receber.
import { addDays, diffDays } from './dates.js';
import { nthOccurrence, isRecurring } from './recurrence.js';
import { sumBy } from './money.js';
import { matchesQuery } from './text.js';

export const SOON_DAYS = 7;

export const BILL_REMIND_OPTIONS = [
  { id: 0, label: 'No dia' },
  { id: 1, label: '1 dia antes' },
  { id: 3, label: '3 dias antes' },
  { id: 7, label: '7 dias antes' },
];

export const BILL_KIND = {
  pay: { label: 'A pagar', verb: 'Pagar', done: 'Paga', doneVerb: 'Marcar como paga', tx: 'expense' },
  receive: { label: 'A receber', verb: 'Recebi', done: 'Recebida', doneVerb: 'Marcar como recebida', tx: 'income' },
};

export function billState(bill, today, soonDays = SOON_DAYS) {
  if (bill.status === 'paid') return 'paid';
  const diff = diffDays(today, bill.dueDate);
  if (diff < 0) return 'overdue';
  if (diff <= soonDays) return 'soon';
  return 'upcoming';
}

export const STATE_LABEL = { overdue: 'Vencidas', soon: 'Vencem em breve', upcoming: 'Próximas', paid: 'Pagas' };

export function groupBills(bills, kind, today, query = '') {
  const groups = { overdue: [], soon: [], upcoming: [], paid: [] };
  for (const bill of bills) {
    if (bill.deleted || (kind && bill.kind !== kind)) continue;
    if (query && !matchesQuery([bill.description, bill.notes], query)) continue;
    groups[billState(bill, today)].push(bill);
  }
  const byDue = (a, b) => (a.dueDate === b.dueDate ? a.description.localeCompare(b.description, 'pt-BR') : a.dueDate < b.dueDate ? -1 : 1);
  groups.overdue.sort(byDue);
  groups.soon.sort(byDue);
  groups.upcoming.sort(byDue);
  groups.paid.sort((a, b) => ((a.paidAt || a.dueDate) < (b.paidAt || b.dueDate) ? 1 : -1));
  return groups;
}

export function openBills(bills, kind) {
  return bills.filter((b) => !b.deleted && b.status !== 'paid' && (!kind || b.kind === kind));
}

// Contas em aberto que vencem no intervalo (inclui as vencidas se pedido).
export function billsDueBetween(bills, from, to, { kind, includeOverdue = false, today } = {}) {
  return openBills(bills, kind)
    .filter((b) => (b.dueDate >= from && b.dueDate <= to) || (includeOverdue && today && b.dueDate < today))
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

// Contas para o painel inicial: vencidas e as que vencem nos próximos dias.
export function upcomingForHome(bills, today, days = SOON_DAYS) {
  return billsDueBetween(bills, today, addDays(today, days), { includeOverdue: true, today });
}

export function totalAmount(bills) {
  return sumBy(bills, (b) => b.amount);
}

// Próxima conta de uma série recorrente, a partir do vencimento atual.
export function nextBillDue(bill) {
  if (!isRecurring(bill)) return null;
  const start = bill.seriesStart || bill.dueDate;
  // Usa o índice da série para não "encolher" o dia (31 → 28 → 28...).
  let k = 1;
  let next = nthOccurrence(start, bill.repeat, k);
  while (next <= bill.dueDate && k < 1000) next = nthOccurrence(start, bill.repeat, ++k);
  return next;
}

// Calcula o que muda ao marcar como paga/recebida. Não cria lançamento — isso é perguntado ao usuário.
export function planPayment(bill, { date, amount }, allBills) {
  const patch = { status: 'paid', paidAt: date, paidAmount: amount ?? bill.amount };
  let next = null;
  const nextDue = nextBillDue(bill);
  if (nextDue) {
    const seriesId = bill.seriesId || bill.id;
    const exists = allBills.some((b) => !b.deleted && (b.seriesId || b.id) === seriesId && b.dueDate === nextDue);
    if (!exists) {
      next = {
        kind: bill.kind,
        description: bill.description,
        amount: bill.amount,
        dueDate: nextDue,
        category: bill.category || null,
        walletId: bill.walletId || null,
        notes: bill.notes || '',
        repeat: bill.repeat,
        remind: bill.remind || [],
        status: 'open',
        seriesId,
        seriesStart: bill.seriesStart || bill.dueDate,
        generatedFrom: bill.id,
      };
    }
  }
  return { patch, next };
}
