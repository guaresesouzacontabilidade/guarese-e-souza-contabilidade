// Relatórios: períodos, séries mensais e comparações em linguagem simples.
import {
  addDays, addMonths, diffDays, monthsBetween, startOfMonth, endOfMonth, startOfYear, endOfYear,
  formatDayMonth, formatMonthYear, monthName, MONTHS, parseISODate,
} from './dates.js';
import { totals, byCategory } from './finance.js';
import { formatMoney, formatPercent } from './money.js';

export function periodPresets(today) {
  const lastMonth = addMonths(today, -1);
  return [
    { id: 'month', label: 'Este mês', from: startOfMonth(today), to: endOfMonth(today) },
    { id: 'last-month', label: 'Mês passado', from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) },
    { id: '3-months', label: 'Últimos 3 meses', from: startOfMonth(addMonths(today, -2)), to: endOfMonth(today) },
    { id: 'year', label: 'Este ano', from: startOfYear(today), to: endOfYear(today) },
  ];
}

const isWholeMonths = (from, to) => from === startOfMonth(from) && to === endOfMonth(to);

export function periodLabel(from, to) {
  if (isWholeMonths(from, to)) {
    if (from.slice(0, 7) === to.slice(0, 7)) return formatMonthYear(from);
    if (from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4)) return `ano de ${from.slice(0, 4)}`;
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    return sameYear ? `${monthName(from)} a ${formatMonthYear(to)}` : `${formatMonthYear(from)} a ${formatMonthYear(to)}`;
  }
  if (from === to) return formatDayMonth(from, '0000');
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (sameMonth) return `${Number(from.slice(8))} a ${formatDayMonth(to, '0000')}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return sameYear ? `${formatDayMonth(from, from)} a ${formatDayMonth(to, '0000')}` : `${formatDayMonth(from, '0000')} a ${formatDayMonth(to, '0000')}`;
}

export function previousPeriod(from, to) {
  if (isWholeMonths(from, to)) {
    const n = monthsBetween(from, to) + 1;
    return { from: startOfMonth(addMonths(from, -n)), to: endOfMonth(addMonths(to, -n)) };
  }
  const len = diffDays(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

// Se o período ainda não terminou, compara só os dias já passados com os mesmos dias do período anterior.
export function comparableRanges(from, to, today) {
  const prev = previousPeriod(from, to);
  if (today >= from && today < to) {
    const elapsed = diffDays(from, today);
    let prevTo = addDays(prev.from, elapsed);
    if (isWholeMonths(from, to)) {
      const shift = monthsBetween(prev.from, from);
      prevTo = addMonths(today, -shift);
    }
    if (prevTo > prev.to) prevTo = prev.to;
    return { cur: { from, to: today }, prev: { from: prev.from, to: prevTo }, partial: true };
  }
  return { cur: { from, to }, prev, partial: false };
}

export function monthlySeries(transactions, from, to, max = 12) {
  const months = [];
  let m = startOfMonth(from);
  const last = startOfMonth(to);
  while (m <= last) {
    months.push(m);
    m = addMonths(m, 1);
  }
  return months.slice(-max).map((start) => {
    const t = totals(transactions, start, endOfMonth(start));
    return { month: start, label: MONTHS[parseISODate(start).getMonth()].slice(0, 3), income: t.income, expense: t.expense, balance: t.balance };
  });
}

function prevName(range) {
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) return `em ${monthName(range.from)}`;
  return 'no período anterior';
}

function changeSentence(cur, prev, { subject, more, less, same, prevText, partial }) {
  const lead = partial ? 'Até agora, ' : '';
  const ref = partial ? `${prevText.replace(/^em /, 'no mesmo período de ').replace('no período anterior', 'no mesmo trecho do período anterior')}` : prevText;
  if (!prev && !cur) return null;
  if (!prev) return `${lead}não há ${subject} registradas ${ref} para comparar.`.replace(/^./, (c) => c.toUpperCase());
  const diff = cur - prev;
  const ratio = Math.abs(diff) / prev;
  if (ratio < 0.01) return `${lead}${same} que ${ref}.`.replace(/^./, (c) => c.toUpperCase());
  const pct = formatPercent(ratio);
  return `${lead}${diff < 0 ? less : more} ${formatMoney(Math.abs(diff))} ${diff < 0 ? 'a menos' : 'a mais'} que ${ref} (${diff < 0 ? '-' : '+'}${pct}).`.replace(/^./, (c) => c.toUpperCase());
}

export function comparePeriods(transactions, from, to, today, custom = []) {
  const ranges = comparableRanges(from, to, today);
  const cur = totals(transactions, ranges.cur.from, ranges.cur.to);
  const prev = totals(transactions, ranges.prev.from, ranges.prev.to);
  const prevText = prevName(ranges.prev);
  const sentences = [];

  const exp = changeSentence(cur.expense, prev.expense, {
    subject: 'despesas', more: 'você gastou', less: 'você gastou', same: 'suas despesas ficaram praticamente no mesmo valor', prevText, partial: ranges.partial,
  });
  if (exp) sentences.push(exp);
  const inc = changeSentence(cur.income, prev.income, {
    subject: 'receitas', more: 'você recebeu', less: 'você recebeu', same: 'suas receitas ficaram praticamente no mesmo valor', prevText, partial: ranges.partial,
  });
  if (inc) sentences.push(inc);

  // Categoria que mais subiu e a que mais caiu.
  if (prev.expense && cur.expense) {
    const a = new Map(byCategory(cur.list, 'expense', custom).map((c) => [c.id, c]));
    const b = new Map(byCategory(prev.list, 'expense', custom).map((c) => [c.id, c]));
    const ids = new Set([...a.keys(), ...b.keys()]);
    let up = null;
    let down = null;
    for (const id of ids) {
      const delta = (a.get(id)?.total || 0) - (b.get(id)?.total || 0);
      const label = (a.get(id) || b.get(id)).category.label;
      if (delta > 0 && (!up || delta > up.delta)) up = { label, delta };
      if (delta < 0 && (!down || delta < down.delta)) down = { label, delta };
    }
    if (up) sentences.push(`O maior aumento foi em ${up.label}: ${formatMoney(up.delta)} a mais.`);
    if (down) sentences.push(`A maior redução foi em ${down.label}: ${formatMoney(-down.delta)} a menos.`);
  }

  return { ...ranges, curTotals: cur, prevTotals: prev, sentences };
}

export function balanceSentence(t) {
  if (!t.income && !t.expense) return 'Nenhum lançamento neste período.';
  if (t.balance > 0) return `As receitas superaram as despesas em ${formatMoney(t.balance)}.`;
  if (t.balance < 0) return `As despesas passaram as receitas em ${formatMoney(-t.balance)}.`;
  return 'Receitas e despesas ficaram empatadas.';
}
