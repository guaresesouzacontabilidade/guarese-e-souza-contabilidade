// Relatórios sem complicação: totais, categorias, meses e comparação em frases.
import { html, useMemo, useState, useRef, useEffect } from '../../vendor/preact.js';
import { todayISO, isValidISODate, addMonths, startOfMonth, MONTHS, parseISODate, formatMonthYear } from '../../core/dates.js';
import { totals, byCategory } from '../../core/finance.js';
import { formatPercent } from '../../core/money.js';
import { periodPresets, periodLabel, comparePeriods, monthlySeries, balanceSentence } from '../../core/reports.js';
import { Chips, Money, Icon, Empty, Button, Segmented, CategoryIcon, Field } from '../components.js';
import { navigate } from '../state.js';
import { openAddForm } from '../forms/add.js';
import { downloadTransactionsCSV } from '../../data/backup.js';
import { getState } from '../../data/store.js';

function setParams(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  const q = new URLSearchParams(clean).toString();
  navigate(`/relatorios${q ? `?${q}` : ''}`);
}

function useWidth(ref) {
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(260, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

// Valor curto para eixos: "R$ 2,5 mil".
function shortMoney(cents) {
  const v = cents / 100;
  if (v >= 1000000) return `R$ ${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v)}`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

// Barra com cantos arredondados só no topo, apoiada na base.
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function MonthlyChart({ series }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [active, setActive] = useState(series.length - 1);
  const [table, setTable] = useState(false);
  const hidden = getState().prefs.hideValues;
  const H = 200;
  const top = 12;
  const bottom = 26;
  const left = 0;
  const plotH = H - top - bottom;
  const max = niceMax(Math.max(1, ...series.flatMap((m) => [m.income, m.expense])));
  const slot = (width - left) / series.length;
  const bw = Math.max(6, Math.min(22, (slot - 14) / 2));
  const y = (v) => top + plotH - (v / max) * plotH;
  const cur = series[Math.min(active, series.length - 1)];

  return html`<div class="cols" ref=${ref}>
    <div class="cols-legend">
      <span><i style=${{ background: 'var(--series-in)' }}></i>Receitas</span>
      <span><i style=${{ background: 'var(--series-out)' }}></i>Despesas</span>
      <button type="button" class="link-btn" style=${{ marginLeft: 'auto', minHeight: '28px' }} onClick=${() => setTable(!table)} aria-pressed=${table ? 'true' : 'false'}>
        <span>${table ? 'Ver gráfico' : 'Ver tabela'}</span>
      </button>
    </div>
    ${table
      ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead>
          <tbody>
            ${series.map(
              (m) => html`<tr key=${m.month}>
                <td>${MONTHS[parseISODate(m.month).getMonth()]}</td>
                <td><${Money} value=${m.income} /></td>
                <td><${Money} value=${m.expense} /></td>
                <td><${Money} value=${m.balance} /></td>
              </tr>`,
            )}
          </tbody>
        </table></div>`
      : html`<svg class="cols-svg" viewBox=${`0 0 ${width} ${H}`} width=${width} height=${H} role="img" aria-label="Receitas e despesas por mês">
            ${[0.5, 1].map((f) => html`<line key=${f} class="grid" x1="0" x2=${width} y1=${y(max * f)} y2=${y(max * f)} />`)}
            ${!hidden && html`<text class="lbl" x="2" y=${y(max) - 2}>${shortMoney(max)}</text>`}
            <line class="base" x1="0" x2=${width} y1=${y(0)} y2=${y(0)} />
            ${series.map((m, i) => {
              const cx = left + slot * i + slot / 2;
              return html`<g key=${m.month}>
                <rect class=${`hit ${i === active ? 'is-active' : ''}`} x=${left + slot * i + 2} y=${top - 6} width=${slot - 4} height=${plotH + 6} rx="10"
                  onClick=${() => setActive(i)} onMouseEnter=${() => setActive(i)} />
                <path class="col-in" d=${barPath(cx - bw - 1, y(m.income), bw, y(0) - y(m.income))} pointer-events="none" />
                <path class="col-out" d=${barPath(cx + 1, y(m.expense), bw, y(0) - y(m.expense))} pointer-events="none" />
                <text class="lbl" x=${cx} y=${H - 6} text-anchor="middle" pointer-events="none">${m.label}</text>
              </g>`;
            })}
          </svg>
          ${cur &&
          html`<div class="col-tip" aria-live="polite">
            <strong>${formatMonthYear(cur.month)}</strong>
            <div class="row"><span>Receitas</span><${Money} value=${cur.income} /></div>
            <div class="row"><span>Despesas</span><${Money} value=${cur.expense} /></div>
            <div class="row"><span>Saldo</span><strong><${Money} value=${cur.balance} /></strong></div>
          </div>`}`}
  </div>`;
}

function CategoryBars({ list, type }) {
  if (!list.length) {
    return html`<p class="day-empty" style=${{ padding: '8px 2px' }}>${type === 'expense' ? 'Nenhuma despesa' : 'Nenhuma receita'} neste período.</p>`;
  }
  const max = list[0].total;
  return html`<div class="bars">
    ${list.slice(0, 10).map(
      (c) => html`<div class="bar-row" key=${c.id}>
        <div class="bar-top">
          <${CategoryIcon} icon=${c.category.icon} tone=${type} size=${18} />
          <span class="name">${c.category.label}</span>
          <span class="val"><${Money} value=${c.total} /></span>
          <span class="pct">${formatPercent(c.share)}</span>
        </div>
        <div class="bar-track" aria-hidden="true">
          <div class=${`bar-fill ${type === 'income' ? 'is-income' : ''}`} style=${{ width: `${Math.max(2, (c.total / max) * 100)}%` }}></div>
        </div>
      </div>`,
    )}
    ${list.length > 10 && html`<p class="hero-hint">+ ${list.length - 10} categorias menores</p>`}
  </div>`;
}

export function ReportsView({ s, params }) {
  const today = todayISO();
  const presets = periodPresets(today);
  const custom = params.periodo === 'custom';
  const preset = presets.find((p) => p.id === params.periodo) || presets[0];
  const from = custom && isValidISODate(params.de) ? params.de : preset.from;
  const to = custom && isValidISODate(params.ate) && params.ate >= from ? params.ate : custom ? today : preset.to;
  const [catType, setCatType] = useState('expense');
  const customCats = s.settings.customCategories || [];

  const t = useMemo(() => totals(s.transactions, from, to), [s.transactions, from, to]);
  const cats = useMemo(() => byCategory(t.list, catType, customCats), [t, catType]);
  const cmp = useMemo(() => comparePeriods(s.transactions, from, to, today, customCats), [s.transactions, from, to, today]);
  const seriesFrom = startOfMonth(addMonths(to > today ? today : to, -5));
  const series = useMemo(() => monthlySeries(s.transactions, from < seriesFrom ? from : seriesFrom, to > today ? today : to, 12), [s.transactions, from, to]);
  const hasAny = s.transactions.some((x) => !x.deleted);

  const periodOptions = [...presets.map((p) => ({ id: p.id, label: p.label })), { id: 'custom', label: 'Escolher datas' }];

  return html`<div class="view stack">
    <header class="page-head">
      <div>
        <h1 class="page-title">Relatórios</h1>
        <p class="page-sub">${periodLabel(from, to).replace(/^./, (c) => c.toUpperCase())}</p>
      </div>
    </header>

    <${Chips}
      label="Período"
      options=${periodOptions}
      value=${custom ? 'custom' : preset.id}
      onChange=${(v) => setParams(v === 'custom' ? { periodo: 'custom', de: from, ate: to } : { periodo: v === 'month' ? '' : v })}
      wrap=${false}
    />
    ${custom &&
    html`<div class="custom-range">
      <${Field} label="De" id="rep-from">
        <input id="rep-from" type="date" class="input" value=${from} onInput=${(e) => e.currentTarget.value && setParams({ periodo: 'custom', de: e.currentTarget.value, ate: to })} />
      </${Field}>
      <${Field} label="Até" id="rep-to">
        <input id="rep-to" type="date" class="input" value=${to} onInput=${(e) => e.currentTarget.value && setParams({ periodo: 'custom', de: from, ate: e.currentTarget.value })} />
      </${Field}>
    </div>`}

    ${!hasAny
      ? html`<div class="card"><${Empty}
          icon="chart-column"
          title="Ainda não há dados para relatório"
          text="Os relatórios usam apenas o que você registrar. Comece pela primeira despesa ou receita."
          action=${html`<${Button} icon="plus" onClick=${() => openAddForm('expense')}>Registrar despesa</${Button}>`}
        /></div>`
      : html`
          <div class="kpis">
            <div class="kpi"><div class="kpi-label">Receitas</div><div class="kpi-value amount-in"><${Money} value=${t.income} /></div></div>
            <div class="kpi"><div class="kpi-label">Despesas</div><div class="kpi-value"><${Money} value=${t.expense} /></div></div>
            <div class="kpi"><div class="kpi-label">Saldo</div><div class=${`kpi-value ${t.balance < 0 ? 'amount-neg' : ''}`}><${Money} value=${t.balance} /></div></div>
          </div>

          <div class="two-col">
          <section class="card" aria-label="Em resumo">
            <h2 class="card-title" style=${{ marginBottom: '12px' }}><${Icon} name="sparkles" size=${18} />Em resumo</h2>
            <ul class="sentences">
              <li><${Icon} name="info" size=${18} /><span>${s.prefs.hideValues ? 'Valores ocultos. Toque no olho para ver.' : balanceSentence(t)}</span></li>
              ${!s.prefs.hideValues && cmp.sentences.map((txt) => html`<li key=${txt}><${Icon} name="arrow-right" size=${18} /><span>${txt}</span></li>`)}
            </ul>
            ${cmp.partial && html`<p class="hero-hint" style=${{ marginTop: '10px' }}>Comparação justa: como o período ainda está em andamento, usamos os mesmos dias do período anterior (${periodLabel(cmp.prev.from, cmp.prev.to)}).</p>`}
          </section>

          <section class="card" aria-label="Por categoria">
            <div class="card-head">
              <h2 class="card-title"><${Icon} name="chart-pie" size=${18} />Por categoria</h2>
            </div>
            <${Segmented}
              label="Tipo"
              options=${[{ id: 'expense', label: 'Despesas' }, { id: 'income', label: 'Receitas' }]}
              value=${catType}
              onChange=${setCatType}
              className="mb"
            />
            <div style=${{ marginTop: '16px' }}><${CategoryBars} list=${cats} type=${catType} /></div>
          </section>
          </div>

          <section class="card" aria-label="Mês a mês">
            <h2 class="card-title" style=${{ marginBottom: '12px' }}><${Icon} name="chart-column" size=${18} />Mês a mês</h2>
            <${MonthlyChart} key=${series.map((m) => m.month).join()} series=${series} />
          </section>

          <button type="button" class="link-btn" style=${{ justifySelf: 'center' }} onClick=${() => downloadTransactionsCSV(t.list, `meu-dia-${from}-a-${to}.csv`)}>
            <${Icon} name="download" size=${16} /><span>Exportar lançamentos deste período (CSV)</span>
          </button>
        `}
  </div>`;
}
