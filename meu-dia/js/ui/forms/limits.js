// Limites de gasto por categoria (ex.: Mercado R$ 800 por mês).
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { todayISO, addMonths, startOfMonth, endOfMonth } from '../../core/dates.js';
import { formatMoney, sumBy } from '../../core/money.js';
import { categoriesFor, findCategory } from '../../core/categories.js';
import { categoryLimits } from '../../core/finance.js';
import { Button, Icon, Chips, MoneyInput, SheetHeader, SheetActions, Hint, Money, Meter } from '../components.js';
import { openSheet, toast } from '../state.js';

// Média gasta na categoria nos meses anteriores com registros (até 3), para ajudar a escolher um limite realista.
function averageSpent(transactions, categoryId, today) {
  const from = addMonths(startOfMonth(today), -3);
  const to = endOfMonth(addMonths(startOfMonth(today), -1));
  const inWindow = transactions.filter((t) => !t.deleted && t.date >= from && t.date <= to);
  const months = new Set(inWindow.map((t) => t.date.slice(0, 7))).size;
  const list = inWindow.filter((t) => t.type === 'expense' && t.category === categoryId);
  return { value: months && list.length ? Math.round(sumBy(list, (t) => t.amount) / months) : 0, months };
}

function LimitsSheet({ onClose, initial = null }) {
  const s = store.getState();
  const today = todayISO();
  const custom = s.settings.customCategories || [];
  const [limits, setLimits] = useState({ ...(s.settings.categoryBudgets || {}) });
  const [editing, setEditing] = useState(initial);
  const [value, setValue] = useState(initial ? limits[initial] || 0 : 0);
  const status = categoryLimits(limits, s.transactions, today, custom);
  const free = categoriesFor('expense', custom).filter((c) => !limits[c.id]);

  const edit = (id) => {
    setEditing(id);
    setValue(limits[id] || 0);
  };
  const save = (amount) => {
    store.setCategoryLimit(editing, amount);
    const label = findCategory(editing, 'expense', custom).label;
    const next = { ...limits };
    if (amount > 0) next[editing] = amount;
    else delete next[editing];
    setLimits(next);
    setEditing(null);
    toast(amount > 0 ? `Limite de ${label}: ${formatMoney(amount)} por mês` : `Limite de ${label} removido`, { tone: 'success' });
  };

  if (editing) {
    const cat = findCategory(editing, 'expense', custom);
    const spent = sumBy(s.transactions.filter((t) => !t.deleted && t.type === 'expense' && t.category === editing && t.date >= startOfMonth(today) && t.date <= endOfMonth(today)), (t) => t.amount);
    const avg = averageSpent(s.transactions, editing, today);
    return html`<form
      class="form"
      novalidate
      onSubmit=${(e) => {
        e.preventDefault();
        save(value);
      }}
    >
      <${SheetHeader} title=${`Limite para ${cat.label}`} subtitle="Quanto você quer gastar, no máximo, por mês nesta categoria." onClose=${onClose} />
      <${MoneyInput} big value=${value} onChange=${setValue} autoFocus label=${`Limite mensal de ${cat.label}`} />
      <${Hint} icon="chart-column">
        Este mês: <strong>${formatMoney(spent)}</strong>.
        ${avg.value
          ? html` Média ${avg.months === 1 ? 'do mês anterior' : `dos ${avg.months} meses anteriores`}: <strong>${formatMoney(avg.value)}</strong> por mês.`
          : ' Ainda não há gastos dos meses anteriores nesta categoria.'}
      </${Hint}>
      <${Hint}>O app avisa quando a categoria chegar a 80% e quando atingir o limite.</${Hint}>
      <${SheetActions}>
        ${limits[editing] ? html`<${Button} variant="secondary" onClick=${() => save(0)}>Remover limite</${Button}>` : html`<${Button} variant="secondary" onClick=${() => setEditing(null)}>Voltar</${Button}>`}
        <${Button} type="submit" size="lg" icon="check" disabled=${!value}>Salvar</${Button}>
      </${SheetActions}>
    </form>`;
  }

  return html`<div class="form">
    <${SheetHeader} title="Limites por categoria" subtitle="Um teto de gastos por mês para as categorias que você quiser." onClose=${onClose} />
    ${status.length > 0
      ? html`<div class="limits">
          ${status.map(
            (l) => html`<button type="button" class="limit is-button" key=${l.id} onClick=${() => edit(l.id)} aria-label=${`${l.category.label}: limite de ${formatMoney(l.budget)}. Editar`}>
              <span class="limit-top">
                <span class="limit-name"><${Icon} name=${l.category.icon} size=${16} />${l.category.label}</span>
                <span class="limit-amt"><${Money} value=${l.spent} /> de <${Money} value=${l.budget} /></span>
              </span>
              <${Meter} ratio=${l.ratio} level=${l.level} label=${`${l.category.label}: ${Math.round(l.ratio * 100)}% do limite`} />
            </button>`,
          )}
        </div>`
      : html`<${Hint} icon="gauge">Escolha uma categoria abaixo para definir um limite. O orçamento mensal geral continua valendo.</${Hint}>`}
    ${free.length > 0 &&
    html`<div>
      <h3 class="group-title" style=${{ paddingTop: '4px' }}>${status.length ? 'Adicionar limite' : 'Categorias'}</h3>
      <${Chips} label="Categoria para limitar" options=${free} value=${null} onChange=${(id) => id && edit(id)} />
    </div>`}
  </div>`;
}

export function openCategoryLimits(categoryId = null) {
  return openSheet((close) => html`<${LimitsSheet} onClose=${close} initial=${categoryId} />`);
}
