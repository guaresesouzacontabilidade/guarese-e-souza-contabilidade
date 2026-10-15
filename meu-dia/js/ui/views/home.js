// Tela inicial: o que importa agora.
import { html, useMemo } from '../../vendor/preact.js';
import { todayISO, greeting, formatLongDate, timeHM, monthName, endOfMonth, startOfMonth, diffDays, capitalize } from '../../core/dates.js';
import { todayAgenda, overdueTasks, daySummary } from '../../core/agenda.js';
import { totals, budgetStatus, budgetMessage, walletsTotal, live, frequentEntries } from '../../core/finance.js';
import { upcomingForHome, totalAmount } from '../../core/bills.js';
import { findCategory, categoryHue } from '../../core/categories.js';
import { formatMoney, formatPercent } from '../../core/money.js';
import { plural } from '../../core/text.js';
import * as store from '../../data/store.js';
import { Card, Icon, Money, AnimatedMoney, HideValuesButton, LinkButton, Empty, Ring, Button, CategoryIcon } from '../components.js';
import { AgendaRow, BillRow } from '../rows.js';
import { navigate, useNow, toast } from '../state.js';
import { openAddMenu, openAddForm, ADD_OPTIONS } from '../forms/add.js';
import { openBudgetSheet } from './settings.js';
import { ForecastBox, LimitAlerts } from '../planning.js';
import { feedback } from '../../services/feedback.js';

const TYPE_DONE = { expense: 'Despesa', income: 'Receita' };

// Registra de novo um lançamento que a pessoa repete sempre igual (com "Desfazer").
function repeatEntry(entry) {
  const { count, ...data } = entry;
  const created = store.create('transactions', { ...data, date: todayISO(), notes: '' });
  feedback('save');
  toast(`${TYPE_DONE[entry.type]} “${entry.description}” de ${formatMoney(entry.amount)} registrada`, {
    tone: 'success',
    action: { label: 'Desfazer', onClick: () => store.remove('transactions', created.id) },
  });
}

function QuickActions({ s, today }) {
  const frequent = useMemo(() => frequentEntries(s.transactions, today), [s.transactions, today]);
  const custom = s.settings.customCategories;
  return html`<section class="quick o-3" aria-labelledby="quick-title">
    <h2 class="group-title" id="quick-title" style=${{ paddingTop: 0 }}>Adicionar rápido</h2>
    <div class="quick-row">
      ${ADD_OPTIONS.filter((o) => !o.menuOnly).map(
        (o) => html`<button type="button" key=${o.id} class=${`quick-btn is-${o.id}`} onClick=${() => openAddForm(o.id)}>
          <span class="q-ico"><${Icon} name=${o.icon} size=${18} /></span>
          <span>${o.label}</span>
        </button>`,
      )}
    </div>
    ${frequent.length > 0 &&
    html`<div class="repeat">
      <h3 class="repeat-title"><${Icon} name="zap" size=${15} />Registrar de novo com um toque</h3>
      <div class="repeat-row">
        ${frequent.map((f) => {
          const cat = findCategory(f.category, f.type, custom);
          return html`<button
            type="button"
            class="repeat-btn"
            key=${`${f.description}|${f.amount}`}
            onClick=${() => repeatEntry(f)}
            aria-label=${`Registrar ${f.type === 'income' ? 'receita' : 'despesa'} “${f.description}” de ${formatMoney(f.amount)} hoje`}
          >
            <${CategoryIcon} icon=${f.category ? cat.icon : 'zap'} tone=${f.type} hue=${f.category ? categoryHue(cat) : null} size=${16} />
            <span class="repeat-text">
              <span class="repeat-name">${f.description}</span>
              <span class="repeat-amount"><${Money} value=${f.amount} /></span>
            </span>
          </button>`;
        })}
      </div>
    </div>`}
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
    className="o-2"
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

// Cartão principal: saldo do mês num fundo vivo, com receitas e despesas.
function MonthCard({ s, today }) {
  const t = useMemo(() => totals(s.transactions, startOfMonth(today), endOfMonth(today)), [s.transactions, today]);
  const wallets = live(s.wallets);
  const walletSum = wallets.length ? walletsTotal(wallets, s.transactions, today) : null;
  const month = monthName(today);
  return html`<${Card} className="card-hero o-1" title=${`Finanças de ${month}`} icon="wallet" action=${html`<${HideValuesButton} />`}>
    <div class="hero-label">Saldo do mês</div>
    <div class=${`hero-value num ${t.balance < 0 && !s.prefs.hideValues ? 'is-negative' : ''}`}><${AnimatedMoney} value=${t.balance} /></div>
    <div class="hero-hint">Receitas menos despesas de ${month}</div>
    <div class="flow">
      <button type="button" class="flow-item in" onClick=${() => navigate('/financas?tipo=income')}>
        <span class="f-label"><${Icon} name="arrow-down-left" size=${16} />Receitas</span>
        <span class="f-value"><${AnimatedMoney} value=${t.income} /></span>
      </button>
      <button type="button" class="flow-item out" onClick=${() => navigate('/financas?tipo=expense')}>
        <span class="f-label"><${Icon} name="arrow-up-right" size=${16} />Despesas</span>
        <span class="f-value"><${AnimatedMoney} value=${t.expense} /></span>
      </button>
    </div>
    ${walletSum !== null && html`<p class="hero-foot">Saldo nas carteiras: <strong><${Money} value=${walletSum} /></strong></p>`}
  </${Card}>`;
}

// "Seu mês": orçamento em anel, previsão do fim do mês e alertas de limite.
function PlanCard({ s, today }) {
  const t = useMemo(() => totals(s.transactions, startOfMonth(today), endOfMonth(today)), [s.transactions, today]);
  const budget = budgetStatus(s.settings.budget, t.expense, today);
  const daysLeft = diffDays(today, endOfMonth(today)) + 1;
  return html`<${Card} title="Seu mês" icon="target" className="plan-card o-5">
    ${budget
      ? html`<div class="plan-budget">
          <${Ring} ratio=${budget.ratio} level=${budget.level} label=${`Orçamento usado: ${formatPercent(budget.ratio)}`}>
            <strong>${formatPercent(budget.ratio)}</strong><span>usado</span>
          </${Ring}>
          <div class="plan-text">
            <div class="plan-line">${budget.remaining >= 0 ? html`Restam <strong><${Money} value=${budget.remaining} /></strong>` : html`Passou <strong><${Money} value=${-budget.remaining} /></strong>`}</div>
            <div class="plan-sub">de <${Money} value=${budget.budget} /> no orçamento</div>
            <div class=${`budget-note is-${budget.level}`}>
              <${Icon} name=${budget.level === 'ok' ? 'circle-check' : 'triangle-alert'} size=${16} />
              <span>
                ${budgetMessage(budget)}
                ${budget.remaining > 0 && !s.prefs.hideValues ? ` Dá cerca de ${formatMoney(budget.perDay)} por dia (${plural(daysLeft, 'dia restante', 'dias restantes')}).` : ''}
              </span>
            </div>
          </div>
        </div>`
      : html`<button type="button" class="hint" style=${{ width: '100%', textAlign: 'left' }} onClick=${openBudgetSheet}>
          <${Icon} name="target" size=${16} />
          <span><strong>Defina um orçamento mensal</strong> para ver quanto ainda pode gastar. Toque aqui.</span>
        </button>`}
    <${ForecastBox} s=${s} today=${today} />
    <${LimitAlerts} s=${s} today=${today} />
  </${Card}>`;
}

function BillsCard({ bills, today }) {
  const list = useMemo(() => upcomingForHome(bills, today), [bills, today]);
  const pay = list.filter((b) => b.kind === 'pay');
  return html`<${Card}
    title="Contas próximas"
    className="o-4"
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

// Ícone e cor da saudação conforme a hora: amanhecer, sol, entardecer, lua.
function periodIcon(now) {
  const h = now.getHours();
  if (h >= 5 && h < 9) return 'sunrise';
  if (h >= 9 && h < 17) return 'sun';
  if (h >= 17 && h < 19) return 'sunset';
  return 'moon';
}

export function HomeView({ s }) {
  const now = useNow();
  const today = todayISO(now);
  const name = s.settings.name?.trim().split(' ')[0];
  const overdueBills = upcomingForHome(s.bills, today).filter((b) => b.dueDate < today);
  const summary = useMemo(() => daySummary(s.events, s.bills, today, timeHM(now)), [s.events, s.bills, today, now]);
  const icon = periodIcon(now);

  return html`<div class="view stack stagger">
    <header class="greeting" style=${{ '--i': 0 }}>
      <div>
        <p class=${`greet-kicker is-${icon}`}><${Icon} name=${icon} size=${16} />${capitalize(formatLongDate(today))}</p>
        <h1>${greeting(now)}${name ? `, ${name}` : ''}</h1>
        <p class="day-summary">${summary}</p>
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
        <${QuickActions} s=${s} today=${today} />
        <${PlanCard} s=${s} today=${today} />
        <button type="button" class="assist-teaser o-6" onClick=${() => navigate('/assistente')}>
          <span class="a-ico"><${Icon} name="sparkles" /></span>
          <span style=${{ flex: 1 }}>
            <strong>Pergunte ao assistente</strong>
            <span class="sub">“Como vou terminar o mês?”</span>
          </span>
          <${Icon} name="chevron-right" size=${18} />
        </button>
      </div>
    </div>
  </div>`;
}

export { openAddMenu };
