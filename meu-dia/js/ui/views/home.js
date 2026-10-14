// Tela inicial: o que importa agora.
import { html, useMemo } from '../../vendor/preact.js';
import { todayISO, greeting, formatLongDate, timeHM, monthName, endOfMonth, startOfMonth, diffDays } from '../../core/dates.js';
import { todayAgenda, overdueTasks } from '../../core/agenda.js';
import { totals, budgetStatus, budgetMessage, walletsTotal, live } from '../../core/finance.js';
import { upcomingForHome, totalAmount } from '../../core/bills.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { plural } from '../../core/text.js';
import { Card, Icon, Money, HideValuesButton, LinkButton, Empty, Meter, Button } from '../components.js';
import { AgendaRow, BillRow } from '../rows.js';
import { navigate, useNow } from '../state.js';
import { openAddMenu, openAddForm, ADD_OPTIONS } from '../forms/add.js';
import { openBudgetSheet } from './settings.js';
import { ForecastBox, LimitAlerts } from '../planning.js';

function QuickActions() {
  return html`<section class="quick o-4" aria-labelledby="quick-title">
    <h2 class="group-title" id="quick-title" style=${{ paddingTop: 0 }}>Adicionar rápido</h2>
    <div class="quick-row">
      ${ADD_OPTIONS.filter((o) => !o.menuOnly).map(
        (o) => html`<button type="button" key=${o.id} class="quick-btn" onClick=${() => openAddForm(o.id)}>
          <span class="q-ico"><${Icon} name=${o.icon} size=${18} /></span>
          <span>${o.label}</span>
        </button>`,
      )}
    </div>
  </section>`;
}

function TodayCard({ events, today, now }) {
  const { upcoming, finished, total } = useMemo(() => todayAgenda(events, today, timeHM(now)), [events, today, now]);
  const late = useMemo(() => overdueTasks(events, today), [events, today]);
  // Pendentes primeiro; o que já foi feito continua visível (riscado) no fim.
  const shown = [...upcoming.slice(0, 5), ...finished.slice(0, Math.max(0, 6 - Math.min(upcoming.length, 5)))];
  const remaining = upcoming.length + finished.length - shown.length;
  return html`<${Card}
    title="Hoje"
    className="o-1"
    icon="calendar-days"
    action=${html`<${LinkButton} onClick=${() => navigate('/agenda')}>Agenda</${LinkButton}>`}
  >
    ${total === 0 && late.length === 0
      ? html`<${Empty}
          icon="calendar-check"
          title="Nada marcado para hoje"
          text="Que tal anotar um compromisso ou uma tarefa?"
          action=${html`<${Button} variant="secondary" size="sm" icon="plus" onClick=${() => openAddForm('event')}>Novo compromisso</${Button}>`}
        />`
      : html`<div class="list">
          ${late.slice(0, 3).map((o) => html`<${AgendaRow} key=${o.key} occ=${o} overdue />`)}
          ${shown.map((o) => html`<${AgendaRow} key=${o.key} occ=${o} past=${finished.includes(o) && !o.done} />`)}
        </div>
        ${upcoming.length === 0 && total > 0 && late.length === 0 && html`<p class="hero-hint" style=${{ marginTop: '8px' }}>Tudo feito por hoje.</p>`}
        ${remaining > 0 && html`<p class="hero-hint" style=${{ marginTop: '8px' }}>+ ${plural(remaining, 'item', 'itens')} na agenda de hoje</p>`}`}
  </${Card}>`;
}

function MonthCard({ s, today }) {
  const t = useMemo(() => totals(s.transactions, startOfMonth(today), endOfMonth(today)), [s.transactions, today]);
  const budget = budgetStatus(s.settings.budget, t.expense, today);
  const wallets = live(s.wallets);
  const walletSum = wallets.length ? walletsTotal(wallets, s.transactions, today) : null;
  const month = monthName(today);
  const daysLeft = diffDays(today, endOfMonth(today)) + 1;
  return html`<${Card}
    className="card-hero o-2"
    title=${`Finanças de ${month}`}
    icon="wallet"
    action=${html`<${HideValuesButton} />`}
  >
    <div class="hero-label">Saldo do mês</div>
    <div class=${`hero-value num ${t.balance < 0 && !s.prefs.hideValues ? 'is-negative' : ''}`}><${Money} value=${t.balance} /></div>
    <div class="hero-hint">Receitas menos despesas de ${month}</div>
    <div class="flow">
      <button type="button" class="flow-item in" onClick=${() => navigate('/financas?tipo=income')}>
        <span class="f-label"><${Icon} name="arrow-down-left" size=${16} />Receitas</span>
        <span class="f-value"><${Money} value=${t.income} /></span>
      </button>
      <button type="button" class="flow-item out" onClick=${() => navigate('/financas?tipo=expense')}>
        <span class="f-label"><${Icon} name="arrow-up-right" size=${16} />Despesas</span>
        <span class="f-value"><${Money} value=${t.expense} /></span>
      </button>
    </div>
    <${ForecastBox} s=${s} today=${today} />
    ${budget
      ? html`<div class="budget">
          <div class="budget-top">
            <span>Orçamento: <strong>${s.prefs.hideValues ? formatPercent(budget.ratio) : `${formatPercent(budget.ratio)} usado`}</strong></span>
            <span>${budget.remaining >= 0 ? html`Restam <strong><${Money} value=${budget.remaining} /></strong>` : html`Passou <strong><${Money} value=${-budget.remaining} /></strong>`}</span>
          </div>
          <${Meter} ratio=${budget.ratio} level=${budget.level} label=${`Orçamento usado: ${formatPercent(budget.ratio)}`} />
          <div class=${`budget-note is-${budget.level}`}>
            <${Icon} name=${budget.level === 'ok' ? 'circle-check' : 'triangle-alert'} size=${16} />
            <span>
              ${budgetMessage(budget)}
              ${budget.remaining > 0 && !s.prefs.hideValues ? ` Dá cerca de ${formatMoney(budget.perDay)} por dia (${plural(daysLeft, 'dia restante', 'dias restantes')}).` : ''}
            </span>
          </div>
        </div>`
      : html`<button type="button" class="hint" style=${{ marginTop: '16px', width: '100%', textAlign: 'left' }} onClick=${openBudgetSheet}>
          <${Icon} name="target" size=${16} />
          <span><strong>Defina um orçamento mensal</strong> para ver quanto ainda pode gastar. Toque aqui.</span>
        </button>`}
    <${LimitAlerts} s=${s} today=${today} />
    ${walletSum !== null &&
    html`<p class="hero-hint" style=${{ marginTop: '12px' }}>
      Saldo nas carteiras: <strong style=${{ color: 'var(--text)' }}><${Money} value=${walletSum} /></strong>
    </p>`}
  </${Card}>`;
}

function BillsCard({ bills, today }) {
  const list = useMemo(() => upcomingForHome(bills, today), [bills, today]);
  const pay = list.filter((b) => b.kind === 'pay');
  return html`<${Card}
    title="Contas próximas"
    className="o-3"
    icon="receipt"
    action=${html`<${LinkButton} onClick=${() => navigate('/contas')}>Todas</${LinkButton}>`}
  >
    ${list.length === 0
      ? html`<${Empty}
          icon="shield-check"
          title="Nenhuma conta nos próximos 7 dias"
          text=${live(bills).length ? 'Você está em dia.' : 'Cadastre suas contas para ser lembrado antes do vencimento.'}
          action=${!live(bills).length && html`<${Button} variant="secondary" size="sm" icon="plus" onClick=${() => openAddForm('bill')}>Cadastrar conta</${Button}>`}
        />`
      : html`<div class="list">${list.slice(0, 4).map((b) => html`<${BillRow} key=${b.id} bill=${b} compact />`)}</div>
          ${pay.length > 0 && html`<p class="hero-hint" style=${{ marginTop: '8px' }}>A pagar nos próximos 7 dias: <${Money} value=${totalAmount(pay)} /></p>`}`}
  </${Card}>`;
}

export function HomeView({ s }) {
  const now = useNow();
  const today = todayISO(now);
  const name = s.settings.name?.trim().split(' ')[0];
  const overdueBills = upcomingForHome(s.bills, today).filter((b) => b.dueDate < today);

  return html`<div class="view stack stagger">
    <header class="greeting" style=${{ '--i': 0 }}>
      <div>
        <h1>${greeting(now)}${name ? `, ${name}` : ''}</h1>
        <p>${formatLongDate(today)}</p>
      </div>
    </header>

    ${overdueBills.length > 0 &&
    html`<button type="button" class="card-alert" style=${{ '--i': 1 }} onClick=${() => navigate('/contas')}>
      <${Icon} name="triangle-alert" />
      <span class="grow">${plural(overdueBills.length, 'conta vencida', 'contas vencidas')} · <${Money} value=${totalAmount(overdueBills)} /></span>
      <${Icon} name="chevron-right" size=${18} />
    </button>`}

    <div class="home-grid">
      <div class="home-col">
        <${TodayCard} events=${s.events} today=${today} now=${now} />
        <${BillsCard} bills=${s.bills} today=${today} />
      </div>
      <div class="home-col">
        <${MonthCard} s=${s} today=${today} />
        <${QuickActions} />
        <button type="button" class="assist-teaser o-5" onClick=${() => navigate('/assistente')}>
          <span class="a-ico"><${Icon} name="sparkles" /></span>
          <span style=${{ flex: 1 }}>
            <strong>Pergunte ao assistente</strong>
            <span class="sub">“Quanto gastei este mês?”</span>
          </span>
          <${Icon} name="chevron-right" size=${18} />
        </button>
      </div>
    </div>
  </div>`;
}

export { openAddMenu };
