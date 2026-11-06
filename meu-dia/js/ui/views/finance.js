// Finanças: resumo do mês, carteiras e lançamentos.
import { html, useMemo, useState } from '../../vendor/preact.js';
import { todayISO, addMonths, startOfMonth, endOfMonth, formatMonthYear, relativeDay, formatLongDate, capitalize, monthName } from '../../core/dates.js';
import { totals, groupByDate, searchTransactions, walletBalance, budgetStatus, live } from '../../core/finance.js';
import { formatPercent } from '../../core/money.js';
import { categoriesFor } from '../../core/categories.js';
import { IconButton, Icon, Empty, Button, Chips, Money, Meter } from '../components.js';
import { TransactionRow, WalletChip } from '../rows.js';
import { navigate } from '../state.js';
import { openAddForm } from '../forms/add.js';
import { openWalletForm } from '../forms/wallet.js';
import { openImport } from '../forms/import.js';
import { ForecastBox, LimitsCard, InstallmentsCard } from '../planning.js';
import { SwipeHint } from '../swipe.js';

const TYPES = [
  { id: 'all', label: 'Tudo' },
  { id: 'expense', label: 'Despesas' },
  { id: 'income', label: 'Receitas' },
];

function setParams(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v && v !== 'all'));
  const q = new URLSearchParams(clean).toString();
  navigate(`/financas${q ? `?${q}` : ''}`);
}

function Wallets({ s }) {
  const today = todayISO();
  const wallets = live(s.wallets);
  return html`<section aria-label="Carteiras">
    <h2 class="group-title" style=${{ paddingTop: '4px' }}>
      Carteiras
      ${wallets.length > 0 && html`<span class="money"><${Money} value=${wallets.reduce((n, w) => n + walletBalance(w, s.transactions, today), 0)} /></span>`}
    </h2>
    <div class="wallets">
      ${wallets.map((w) => html`<${WalletChip} key=${w.id} wallet=${w} balance=${walletBalance(w, s.transactions, today)} onClick=${() => openWalletForm(w)} />`)}
      <button type="button" class="wallet add" onClick=${() => openWalletForm()}>
        <${Icon} name="plus" />
        <span>${wallets.length ? 'Nova carteira' : 'Adicionar carteira'}</span>
      </button>
    </div>
    ${wallets.length === 0 && html`<p class="field-hint" style=${{ padding: '0 2px' }}>Opcional: cadastre banco, dinheiro ou cartão para ver o saldo de cada um.</p>`}
  </section>`;
}

function SearchResults({ s }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [category, setCategory] = useState('all');
  const custom = s.settings.customCategories || [];
  const cats = type === 'all' ? [] : categoriesFor(type, custom);
  const results = useMemo(() => searchTransactions(s.transactions, query, { type, category }, custom), [s.transactions, query, type, category]);
  const sum = results.reduce((n, t) => n + (t.type === 'income' ? t.amount : -t.amount), 0);
  return html`<div class="stack">
    <label class="search">
      <span class="sr-only">Buscar lançamentos</span>
      <${Icon} name="search" size=${18} />
      <input class="input" type="search" placeholder="Buscar por descrição, categoria ou valor" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} autofocus enterkeyhint="search" />
    </label>
    <${Chips} label="Tipo" options=${TYPES} value=${type} onChange=${(v) => { setType(v || 'all'); setCategory('all'); }} wrap=${false} />
    ${cats.length > 0 && html`<${Chips} label="Categoria" options=${[{ id: 'all', label: 'Todas' }, ...cats]} value=${category} onChange=${(v) => setCategory(v || 'all')} wrap=${false} />`}
    ${results.length === 0
      ? html`<${Empty} icon="search" title="Nada encontrado" text=${query ? `Nenhum lançamento com “${query}”.` : 'Nenhum lançamento com estes filtros.'} />`
      : html`<div class="card">
          <p class="hero-hint" style=${{ marginBottom: '6px' }}>${results.length} ${results.length === 1 ? 'lançamento' : 'lançamentos'} · soma <${Money} value=${sum} signed /></p>
          <div class="list">${results.slice(0, 200).map((t) => html`<${TransactionRow} key=${t.id} t=${t} showDate />`)}</div>
        </div>`}
  </div>`;
}

export function FinanceView({ s, params }) {
  const today = todayISO();
  const month = /^\d{4}-\d{2}$/.test(params.mes || '') ? `${params.mes}-01` : startOfMonth(today);
  const type = TYPES.some((t) => t.id === params.tipo) ? params.tipo : 'all';
  const searching = params.busca === '1';
  const go = (patch) => setParams({ ...params, ...patch });
  const from = startOfMonth(month);
  const to = endOfMonth(month);
  const t = useMemo(() => totals(s.transactions, from, to), [s.transactions, from, to]);
  const list = type === 'all' ? t.list : t.list.filter((x) => x.type === type);
  const groups = useMemo(() => groupByDate(list), [list]);
  const isCurrent = from === startOfMonth(today);
  const budget = isCurrent ? budgetStatus(s.settings.budget, t.expense, today) : null;

  return html`<div class="view stack">
    <header class="page-head">
      <div>
        <h1 class="page-title">Finanças</h1>
        <p class="page-sub">Receitas, despesas e carteiras</p>
      </div>
      <${IconButton} icon=${searching ? 'x' : 'search'} label=${searching ? 'Fechar busca' : 'Buscar lançamentos'} onClick=${() => go({ busca: searching ? '' : '1' })} />
    </header>

    ${searching
      ? html`<${SearchResults} s=${s} />`
      : html`
          <div class="month-nav">
            <${IconButton} icon="chevron-left" label="Mês anterior" onClick=${() => go({ mes: addMonths(from, -1).slice(0, 7) })} />
            <div class="month-nav-title" aria-live="polite">${formatMonthYear(from)}</div>
            ${!isCurrent && html`<button type="button" class="link-btn" onClick=${() => go({ mes: '' })} style=${{ paddingRight: '10px' }}><span>Hoje</span></button>`}
            <${IconButton} icon="chevron-right" label="Próximo mês" onClick=${() => go({ mes: addMonths(from, 1).slice(0, 7) })} />
          </div>

          <div class="kpis">
            <div class="kpi"><div class="kpi-label">Receitas</div><div class="kpi-value amount-in"><${Money} value=${t.income} /></div></div>
            <div class="kpi"><div class="kpi-label">Despesas</div><div class="kpi-value"><${Money} value=${t.expense} /></div></div>
            <div class="kpi"><div class="kpi-label">Saldo do mês</div><div class=${`kpi-value ${t.balance < 0 ? 'amount-neg' : ''}`}><${Money} value=${t.balance} /></div></div>
          </div>

          ${isCurrent && html`<${ForecastBox} s=${s} today=${today} card />`}

          ${budget &&
          html`<div class="card" style=${{ padding: '14px 16px' }}>
            <div class="budget" style=${{ marginTop: 0 }}>
              <div class="budget-top">
                <span>Orçamento de ${monthName(from)}: <strong>${formatPercent(budget.ratio)}</strong> usado</span>
                <span>${budget.remaining >= 0 ? html`Restam <strong><${Money} value=${budget.remaining} /></strong>` : html`Passou <strong><${Money} value=${-budget.remaining} /></strong>`}</span>
              </div>
              <${Meter} ratio=${budget.ratio} level=${budget.level} label=${`Orçamento usado: ${formatPercent(budget.ratio)}`} />
            </div>
          </div>`}

          ${isCurrent && html`<${LimitsCard} s=${s} today=${today} />`}
          ${isCurrent && html`<${InstallmentsCard} s=${s} today=${today} />`}

          <${Wallets} s=${s} />

          <div class="row-actions">
            <${Button} variant="secondary" icon="chart-column" onClick=${() => navigate('/relatorios')}>Relatórios</${Button}>
            <${Button} variant="secondary" icon="file-up" onClick=${() => openImport()}>Importar extrato</${Button}>
            <${Button} variant="secondary" icon="sparkles" onClick=${() => navigate('/assistente')}>Perguntar</${Button}>
          </div>

          <${Chips} label="Mostrar" options=${TYPES} value=${type} onChange=${(v) => go({ tipo: v || 'all' })} wrap=${false} />

          ${groups.length === 0
            ? html`<div class="card"><${Empty}
                icon="wallet"
                title=${`Nenhum lançamento em ${monthName(from)}`}
                text="Registre receitas e despesas para ver seu saldo do mês."
                action=${html`<div class="row-actions" style=${{ width: '100%', maxWidth: '360px' }}>
                  <${Button} variant="secondary" size="sm" icon="arrow-up-right" onClick=${() => openAddForm('expense')}>Despesa</${Button}>
                  <${Button} variant="secondary" size="sm" icon="arrow-down-left" onClick=${() => openAddForm('income')}>Receita</${Button}>
                </div>`}
              /></div>`
            : html`<${SwipeHint} text="Dica: arraste um lançamento para a esquerda para excluir." />
              <div class="card" style=${{ paddingTop: '6px' }}>
                ${groups.map(
                  (g) => html`<section key=${g.date} aria-label=${formatLongDate(g.date)}>
                    <h3 class="group-title">
                      <span>${capitalize(relativeDay(g.date, today))}</span>
                      <span class="money"><${Money} value=${g.income - g.expense} signed /></span>
                    </h3>
                    <div class="list">${g.items.map((x) => html`<${TransactionRow} key=${x.id} t=${x} />`)}</div>
                  </section>`,
                )}
              </div>`}
        `}
  </div>`;
}
