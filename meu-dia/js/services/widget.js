// Envia ao widget "Hoje" do Android um resumo pronto (textos já formatados).
import * as store from '../data/store.js';
import { isNative, plugin } from './native.js';
import { todayISO, addDays, formatLongDate, monthName, startOfMonth, endOfMonth, dueLabel, capitalize } from '../core/dates.js';
import { occurrencesInRange } from '../core/agenda.js';
import { totals } from '../core/finance.js';
import { upcomingForHome } from '../core/bills.js';
import { formatMoney } from '../core/money.js';

export function buildWidgetData(s, today = todayISO()) {
  const hidden = s.prefs.hideValues;
  const money = (v) => (hidden ? 'R$ •••••' : formatMoney(v));
  const end = addDays(today, 6);
  const days = {};
  const dayLabels = {};
  for (let d = today; d <= end; d = addDays(d, 1)) {
    days[d] = [];
    const label = formatLongDate(d);
    dayLabels[d] = capitalize(label.replace('-feira', ''));
  }
  for (const o of occurrencesInRange(s.events, today, end)) {
    if (o.done) continue;
    const prefix = o.item.kind === 'task' ? '☐ ' : o.item.time ? `${o.item.time}  ` : '• ';
    days[o.date].push(`${prefix}${o.item.title}`);
  }
  const month = totals(s.transactions, startOfMonth(today), endOfMonth(today));
  const next = upcomingForHome(s.bills, today).find((b) => b.kind === 'pay');
  return {
    days,
    dayLabels,
    balanceLabel: `Saldo de ${monthName(today)}`,
    balance: money(month.balance),
    bill: next ? `${next.description} · ${dueLabel(next.dueDate, today)} · ${money(next.amount)}` : '',
  };
}

let timer = null;
let last = '';

function push() {
  const p = plugin('MeuDia');
  if (!p) return;
  const data = JSON.stringify(buildWidgetData(store.getState()));
  if (data === last) return;
  last = data;
  p.updateWidget({ data }).catch(() => {});
}

export function startWidgetSync() {
  if (!isNative()) return;
  let prev = store.getState();
  store.subscribe((s) => {
    if (s.events !== prev.events || s.bills !== prev.bills || s.transactions !== prev.transactions || s.prefs !== prev.prefs) {
      clearTimeout(timer);
      timer = setTimeout(push, 1500);
    }
    prev = s;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') push();
  });
  push();
}

// Atalhos do ícone e botões do widget pedem uma tela ("add:expense", "voice:expense", "#/contas").
export async function listenLaunchRoutes(handle) {
  const p = plugin('MeuDia');
  if (!p) return;
  p.addListener('route', (e) => e?.route && handle(e.route));
  try {
    const { route } = await p.takeLaunchRoute();
    if (route) handle(route);
  } catch {
    /* sem rota */
  }
}
