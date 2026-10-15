// Linhas de lista usadas em várias telas.
import { html } from '../vendor/preact.js';
import * as store from '../data/store.js';
import { Icon, Money, CategoryIcon } from './components.js';
import { toast } from './state.js';
import { feedback } from '../services/feedback.js';
import { celebrate } from './fx.js';
import { todayISO, dueLabel, relativeDay } from '../core/dates.js';
import { findCategory, findAgendaCategory } from '../core/categories.js';
import { BILL_KIND, billState } from '../core/bills.js';
import { isRecurring } from '../core/recurrence.js';
import { walletType } from '../core/finance.js';
import { openEventDetail } from './forms/event.js';
import { openTransactionDetail } from './forms/transaction.js';
import { openBillDetail, quickPay } from './forms/bill.js';

export function TaskCheck({ item, date, done }) {
  return html`<button
    type="button"
    class="check"
    role="checkbox"
    aria-checked=${done ? 'true' : 'false'}
    aria-label=${done ? `Desmarcar “${item.title}”` : `Concluir “${item.title}”`}
    onClick=${(e) => {
      e.stopPropagation();
      store.toggleTask(item, date);
      feedback(done ? 'undo' : 'complete');
      if (!done) celebrate({ x: e.clientX, y: e.clientY });
      if (!done) toast('Tarefa concluída', { tone: 'success', duration: 2500, action: { label: 'Desfazer', onClick: () => store.toggleTask(store.findById('events', item.id), date) } });
    }}
  >
    <span class="check-ring"><${Icon} name="check" size=${16} /></span>
  </button>`;
}

export function AgendaRow({ occ, showDate = false, overdue = false, past = false }) {
  const { item, date, done } = occ;
  const today = todayISO();
  const cat = findAgendaCategory(item.category);
  const sub = [];
  // O horário de início já aparece no destaque à esquerda.
  if (item.kind === 'event') sub.push(item.time ? (item.endTime ? `até ${item.endTime}` : 'Compromisso') : 'Dia todo');
  else sub.push(item.time ? `Tarefa · ${item.time}` : 'Tarefa');
  if (showDate || overdue) sub.push(relativeDay(date, today));
  if (item.location) sub.push(item.location);
  if (cat) sub.push(cat.label);

  return html`<div class=${`item ${done ? 'is-done' : ''} ${past ? 'is-past' : ''}`}>
    ${item.kind === 'task'
      ? html`<${TaskCheck} item=${item} date=${date} done=${done} />`
      : html`<span class="time-pill" aria-hidden="true">${item.time || html`<${Icon} name="calendar" size=${18} />`}</span>`}
    <button type="button" class="item-main" onClick=${() => openEventDetail(item, date)} aria-label=${`${item.title}, ${sub.join(', ')}`}>
      <span class="item-body">
        <span class="item-title" style=${{ display: 'block' }}>${item.title}</span>
        <span class="item-sub">
          ${sub.map((t, i) => html`${i > 0 && html`<span class="dot"></span>`}<span>${t}</span>`)}
          ${isRecurring(item) && html`<${Icon} name="repeat" size=${14} label="Repete" />`}
          ${item.priority === 'high' && html`<span class="badge is-danger">Alta</span>`}
          ${overdue && html`<span class="badge is-warning">Atrasada</span>`}
        </span>
      </span>
    </button>
  </div>`;
}

export function TransactionRow({ t, showDate = false }) {
  const s = store.getState();
  const cat = findCategory(t.category, t.type, s.settings.customCategories);
  const wallet = t.walletId ? s.wallets.find((w) => w.id === t.walletId && !w.deleted) : null;
  const sub = [t.category ? cat.label : 'Sem categoria'];
  if (t.installment) sub.push(`Parcela ${t.installment.n}/${t.installment.of}`);
  if (wallet) sub.push(wallet.name);
  if (showDate) sub.push(relativeDay(t.date, todayISO()));
  return html`<button type="button" class="item" onClick=${() => openTransactionDetail(t)}>
    <${CategoryIcon} icon=${t.category ? cat.icon : t.type === 'income' ? 'arrow-down-left' : 'arrow-up-right'} tone=${t.type} />
    <span class="item-body">
      <span class="item-title" style=${{ display: 'block' }}>${t.description}</span>
      <span class="item-sub">${sub.map((x, i) => html`${i > 0 && html`<span class="dot"></span>`}<span>${x}</span>`)}</span>
    </span>
    <span class=${`item-end ${t.type === 'income' ? 'amount-in' : 'amount-out'}`}>
      <${Money} value=${t.type === 'income' ? t.amount : -t.amount} signed />
    </span>
  </button>`;
}

export function BillRow({ bill, compact = false }) {
  const today = todayISO();
  const state = billState(bill, today);
  const kind = BILL_KIND[bill.kind] || BILL_KIND.pay;
  const tone = { overdue: 'danger', soon: 'warning', upcoming: 'neutral', paid: 'ok' }[state];
  const icon = { overdue: 'triangle-alert', soon: 'calendar-clock', upcoming: 'calendar', paid: 'circle-check' }[state];
  const label = state === 'paid' ? `${kind.done} ${relativeDay(bill.paidAt || bill.dueDate, today)}` : dueLabel(bill.dueDate, today);
  const amount = state === 'paid' ? bill.paidAmount ?? bill.amount : bill.amount;
  return html`<div class="item bill-row">
    <button type="button" class="item-main" onClick=${() => openBillDetail(bill)}>
      <span class=${`cat-icon tone-${tone}`} aria-hidden="true"><${Icon} name=${icon} size=${20} /></span>
      <span class="item-body">
        <span class="item-title" style=${{ display: 'block' }}>${bill.description}</span>
        <span class="item-sub">
          <strong class="bill-amount"><${Money} value=${amount} /></strong>
          <span class=${state === 'overdue' ? 'badge is-danger' : state === 'soon' ? 'badge is-warning' : ''}>${label}</span>
          ${!compact && bill.kind === 'receive' && html`<span class="badge is-accent">A receber</span>`}
          ${isRecurring(bill) && html`<${Icon} name="repeat" size=${14} label="Repete" />`}
        </span>
      </span>
    </button>
    ${state !== 'paid' &&
    html`<button type="button" class="btn btn-pay" onClick=${() => quickPay(bill)} aria-label=${`${kind.doneVerb}: ${bill.description}`}>
      <${Icon} name="check" size=${16} />${kind.verb}
    </button>`}
  </div>`;
}

export function WalletChip({ wallet, balance, onClick }) {
  const t = walletType(wallet.type);
  return html`<button type="button" class="wallet" onClick=${onClick}>
    <span class="cat-icon" style=${{ width: '36px', height: '36px', borderRadius: '12px' }}><${Icon} name=${t.icon} size=${18} /></span>
    <span>
      <span class="w-name" style=${{ display: 'block' }}>${wallet.name}</span>
      <span class="w-type">${t.short}</span>
    </span>
    <span class=${`w-bal ${balance < 0 ? 'amount-neg' : ''}`}><${Money} value=${balance} /></span>
  </button>`;
}
