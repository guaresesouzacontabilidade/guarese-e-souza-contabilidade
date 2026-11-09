// Planejamento do mês: previsão do saldo, limites por categoria e compras parceladas.
import { html, useMemo, useState } from '../vendor/preact.js';
import { formatNumeric, MONTHS_SHORT } from '../core/dates.js';
import { formatPercent } from '../core/money.js';
import { plural } from '../core/text.js';
import { categoryLimits } from '../core/finance.js';
import { monthForecast } from '../core/forecast.js';
import { activePlans, upcomingByMonth } from '../core/installments.js';
import { findCategory, categoryHue } from '../core/categories.js';
import { Card, Icon, Money, Meter, LinkButton, CategoryIcon } from './components.js';
import { navigate } from './state.js';
import { openCategoryLimits } from './forms/limits.js';
import { openTransactionDetail } from './forms/transaction.js';

// "Previsão para 31/10": saldo do mês + contas a receber − contas a pagar até o fim do mês.
export function ForecastBox({ s, today, card = false }) {
  const [open, setOpen] = useState(false);
  const f = useMemo(() => monthForecast({ transactions: s.transactions, bills: s.bills }, today), [s.transactions, s.bills, today]);
  if (!f.hasPending) return null;
  const end = formatNumeric(f.date).slice(0, 5);
  const box = html`<div class=${`forecast ${open ? 'is-open' : ''}`}>
    <button type="button" class="forecast-head" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      <span class=${`cat-icon ${f.forecast < 0 ? 'tone-danger' : 'tone-ok'}`}><${Icon} name=${f.forecast < 0 ? 'trending-down' : 'trending-up'} size=${18} /></span>
      <span class="grow">
        <span class="forecast-label">Previsão para ${end}</span>
        <strong class=${`forecast-value ${f.forecast < 0 ? 'amount-neg' : ''}`}><${Money} value=${f.forecast} /></strong>
      </span>
      <span class="forecast-how">${open ? 'Fechar' : 'Como calculei'}<${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${16} /></span>
    </button>
    ${open &&
    html`<div class="forecast-body">
      <ul class="calc">
        <li><span>Saldo do mês${f.scheduledCount ? ` (inclui ${plural(f.scheduledCount, 'lançamento futuro', 'lançamentos futuros')}, como parcelas)` : ''}</span><${Money} value=${f.balance} signed /></li>
        ${f.toReceive > 0 && html`<li><span>A receber até ${end} (${plural(f.receive.length, 'conta', 'contas')})</span><${Money} value=${f.toReceive} signed /></li>`}
        ${f.toPay > 0 && html`<li><span>A pagar até ${end} (${plural(f.pay.length, 'conta', 'contas')}${f.overdueCount ? `, ${plural(f.overdueCount, 'vencida', 'vencidas')}` : ''})</span><${Money} value=${-f.toPay} signed /></li>`}
        <li class="calc-total"><span>Previsão</span><${Money} value=${f.forecast} signed /></li>
      </ul>
      <p class="hero-hint">Gastos do dia a dia que ainda não foram registrados não entram na conta.</p>
    </div>`}
  </div>`;
  return card ? html`<div class="card" style=${{ padding: '4px 6px' }}>${box}</div>` : box;
}

// Alertas curtos no Início: categorias perto (80%) ou acima do limite.
export function LimitAlerts({ s, today }) {
  const list = useMemo(() => categoryLimits(s.settings.categoryBudgets, s.transactions, today, s.settings.customCategories), [s.transactions, s.settings, today]);
  const alerts = list.filter((l) => l.ratio >= 0.8).slice(0, 3);
  if (!alerts.length) return null;
  return html`<div class="limit-alerts">
    ${alerts.map(
      (l) => html`<button type="button" key=${l.id} class=${`budget-note is-${l.ratio >= 1 ? 'over' : 'attention'}`} onClick=${() => navigate('/financas')}>
        <${Icon} name="triangle-alert" size=${16} />
        <span>
          ${l.category.label}: ${l.ratio >= 1 ? (l.spent > l.budget ? 'passou do limite' : 'chegou ao limite') : `${formatPercent(l.ratio)} do limite`}
          ${!s.prefs.hideValues && html` (<${Money} value=${l.spent} /> de <${Money} value=${l.budget} />)`}
        </span>
      </button>`,
    )}
  </div>`;
}

export function LimitsCard({ s, today }) {
  const list = useMemo(() => categoryLimits(s.settings.categoryBudgets, s.transactions, today, s.settings.customCategories), [s.transactions, s.settings, today]);
  if (!list.length) {
    return html`<button type="button" class="hint" style=${{ width: '100%', textAlign: 'left' }} onClick=${() => openCategoryLimits()}>
      <${Icon} name="gauge" size=${16} />
      <span><strong>Limites por categoria:</strong> defina um teto para Mercado, Lazer, Delivery… e seja avisado ao chegar perto.</span>
    </button>`;
  }
  return html`<${Card} title="Limites do mês" icon="gauge" action=${html`<${LinkButton} onClick=${() => openCategoryLimits()}>Editar</${LinkButton}>`}>
    <div class="limits">
      ${list.map(
        (l) => html`<button type="button" class="limit is-button" key=${l.id} onClick=${() => openCategoryLimits(l.id)}>
          <span class="limit-top">
            <span class="limit-name"><span class="hue-ink" style=${{ '--h': categoryHue(l.category) ?? 210 }}><${Icon} name=${l.category.icon} size=${16} /></span>${l.category.label}</span>
            <span class="limit-amt"><${Money} value=${l.spent} /> de <${Money} value=${l.budget} /></span>
          </span>
          <${Meter} ratio=${l.ratio} level=${l.level} label=${`${l.category.label}: ${Math.round(l.ratio * 100)}% do limite`} />
          <span class=${`limit-note is-${l.level}`}>
            ${l.remaining >= 0 ? html`Restam <${Money} value=${l.remaining} />` : html`Passou <${Money} value=${-l.remaining} />`}
          </span>
        </button>`,
      )}
    </div>
  </${Card}>`;
}

const monthLabel = (iso) => MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];

export function InstallmentsCard({ s, today }) {
  const plans = useMemo(() => activePlans(s.transactions, today).filter((p) => p.type === 'expense'), [s.transactions, today]);
  const months = useMemo(() => upcomingByMonth(s.transactions, today, 3), [s.transactions, today]);
  if (!plans.length) return null;
  const custom = s.settings.customCategories;
  return html`<${Card} title="Compras parceladas" icon="calendar-range">
    <div class="kpis">
      ${months.map(
        (m) => html`<div class="kpi" key=${m.month}>
          <div class="kpi-label">Em ${monthLabel(m.month)}</div>
          <div class="kpi-value"><${Money} value=${m.total} /></div>
        </div>`,
      )}
    </div>
    <div class="list" style=${{ marginTop: '8px' }}>
      ${plans.map((p) => {
        const cat = findCategory(p.category, 'expense', custom);
        return html`<button type="button" class="item" key=${p.group} onClick=${() => openTransactionDetail(p.next)}>
          <${CategoryIcon} icon=${p.category ? cat.icon : 'calendar-range'} tone="expense" hue=${p.category ? categoryHue(cat) : null} />
          <span class="item-body">
            <span class="item-title" style=${{ display: 'block' }}>${p.description}</span>
            <span class="item-sub">Faltam ${p.remainingCount} de ${p.of}<span class="dot"></span>próxima ${formatNumeric(p.next.date).slice(0, 5)}</span>
          </span>
          <span class="item-end"><${Money} value=${p.remaining} /></span>
        </button>`;
      })}
    </div>
  </${Card}>`;
}
