// Agenda: visualizações diária, semanal e mensal, busca e filtros.
import { html, useMemo, useState } from '../../vendor/preact.js';
import {
  todayISO, addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDay, weekday, WEEKDAYS_SHORT,
  formatLongDate, formatDayMonth, formatMonthYear, relativeDay, isValidISODate, parseISODate, MONTHS_SHORT, capitalize,
} from '../../core/dates.js';
import { occurrencesOnDay, overdueTasks, daysWithItems, searchAgenda, occurrencesInRange } from '../../core/agenda.js';
import { billsDueBetween } from '../../core/bills.js';
import { nextOccurrence } from '../../core/recurrence.js';
import { plural } from '../../core/text.js';
import { Segmented, IconButton, Icon, Empty, Button, Chips } from '../components.js';
import { AgendaRow, BillRow } from '../rows.js';
import { navigate } from '../state.js';
import { openAddForm } from '../forms/add.js';

const MODES = [
  { id: 'dia', label: 'Dia' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mês' },
];

const FILTERS = [
  { id: 'all', label: 'Tudo' },
  { id: 'event', label: 'Compromissos' },
  { id: 'task', label: 'Tarefas' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'done', label: 'Concluídas' },
];

function setParams(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  const q = new URLSearchParams(clean).toString();
  navigate(`/agenda${q ? `?${q}` : ''}`);
}

function Marks({ info, bills }) {
  if (!info && !bills) return html`<span class="marks"></span>`;
  return html`<span class="marks" aria-hidden="true">
    ${info?.events > 0 && html`<i class="mark"></i>`}
    ${info?.tasks > 0 && html`<i class="mark task"></i>`}
    ${bills > 0 && html`<i class="mark bill"></i>`}
  </span>`;
}

function describe(info, bills) {
  const parts = [];
  if (info?.events) parts.push(plural(info.events, 'compromisso', 'compromissos'));
  if (info?.tasks) parts.push(plural(info.tasks, 'tarefa', 'tarefas'));
  if (bills) parts.push(plural(bills, 'conta', 'contas'));
  return parts.join(', ');
}

function billsByDay(bills, from, to) {
  const map = new Map();
  for (const b of billsDueBetween(bills, from, to)) map.set(b.dueDate, (map.get(b.dueDate) || 0) + 1);
  return map;
}

function DayList({ s, day, today }) {
  const occ = useMemo(() => occurrencesOnDay(s.events, day), [s.events, day]);
  const late = useMemo(() => (day === today ? overdueTasks(s.events, today) : []), [s.events, day, today]);
  const bills = useMemo(() => billsDueBetween(s.bills, day, day), [s.bills, day]);
  const untimed = occ.filter((o) => !o.item.time);
  const timed = occ.filter((o) => o.item.time);

  if (!occ.length && !late.length && !bills.length) {
    return html`<${Empty}
      icon="calendar-check"
      title=${day === today ? 'Dia livre' : `Nada em ${formatDayMonth(day, today)}`}
      text="Toque em Adicionar para criar um compromisso ou uma tarefa."
      action=${html`<${Button} variant="secondary" size="sm" icon="plus" onClick=${() => openAddForm('event', { date: day })}>Novo compromisso</${Button}>`}
    />`;
  }
  return html`<div>
    ${late.length > 0 &&
    html`<h3 class="group-title">Atrasadas</h3>
      <div class="list">${late.map((o) => html`<${AgendaRow} key=${o.key} occ=${o} overdue />`)}</div>`}
    ${untimed.length > 0 &&
    html`<h3 class="group-title">Sem horário</h3>
      <div class="list">${untimed.map((o) => html`<${AgendaRow} key=${o.key} occ=${o} />`)}</div>`}
    ${timed.length > 0 &&
    html`<h3 class="group-title">Horários</h3>
      <div class="list">${timed.map((o) => html`<${AgendaRow} key=${o.key} occ=${o} />`)}</div>`}
    ${bills.length > 0 &&
    html`<h3 class="group-title">Contas que vencem</h3>
      <div class="list">${bills.map((b) => html`<${BillRow} key=${b.id} bill=${b} compact />`)}</div>`}
  </div>`;
}

function WeekStrip({ s, day, today, onPick }) {
  const start = startOfWeek(day);
  const days = eachDay(start, addDays(start, 6));
  const info = useMemo(() => daysWithItems(s.events, start, addDays(start, 6)), [s.events, start]);
  const bills = useMemo(() => billsByDay(s.bills, start, addDays(start, 6)), [s.bills, start]);
  return html`<div class="week-strip" role="group" aria-label="Dias da semana">
    ${days.map((d) => {
      const desc = describe(info.get(d), bills.get(d));
      return html`<button
        type="button"
        key=${d}
        class=${`week-day ${d === day ? 'is-selected' : ''} ${d === today ? 'is-today' : ''}`}
        aria-pressed=${d === day ? 'true' : 'false'}
        aria-label=${`${formatLongDate(d)}${d === today ? ' (hoje)' : ''}${desc ? `: ${desc}` : ''}`}
        onClick=${() => onPick(d)}
      >
        <span>${WEEKDAYS_SHORT[weekday(d)]}</span>
        <span class="n">${Number(d.slice(8))}</span>
        <${Marks} info=${info.get(d)} bills=${bills.get(d)} />
      </button>`;
    })}
  </div>`;
}

function WeekView({ s, day, today }) {
  const start = startOfWeek(day);
  const end = endOfWeek(day);
  const occ = useMemo(() => occurrencesInRange(s.events, start, end), [s.events, start, end]);
  const bills = useMemo(() => billsDueBetween(s.bills, start, end), [s.bills, start, end]);
  return html`<div class="week-list">
    ${eachDay(start, end).map((d) => {
      const items = occ.filter((o) => o.date === d);
      const dayBills = bills.filter((b) => b.dueDate === d);
      return html`<section class="day-block" key=${d}>
        <h3 class=${`day-block-title ${d === today ? 'is-today' : ''}`}>
          ${capitalize(formatLongDate(d).split(',')[0])}
          <span class="rel">${formatDayMonth(d, today)}${d === today ? ' · hoje' : ''}</span>
        </h3>
        ${items.length || dayBills.length
          ? html`<div class="list">
              ${items.map((o) => html`<${AgendaRow} key=${o.key} occ=${o} />`)}
              ${dayBills.map((b) => html`<${BillRow} key=${b.id} bill=${b} compact />`)}
            </div>`
          : html`<p class="day-empty">Livre</p>`}
      </section>`;
    })}
  </div>`;
}

function MonthGrid({ s, day, today, onPick }) {
  const first = startOfMonth(day);
  const gridStart = startOfWeek(first);
  const gridEnd = endOfWeek(endOfMonth(day));
  const days = eachDay(gridStart, gridEnd);
  const info = useMemo(() => daysWithItems(s.events, gridStart, gridEnd), [s.events, gridStart, gridEnd]);
  const bills = useMemo(() => billsByDay(s.bills, gridStart, gridEnd), [s.bills, gridStart, gridEnd]);
  return html`<div class="card" style=${{ padding: '12px' }}>
    <div class="month-grid" role="grid" aria-label=${formatMonthYear(day)}>
      ${WEEKDAYS_SHORT.map((w) => html`<span class="month-head" key=${w} aria-hidden="true">${w.slice(0, 3)}</span>`)}
      ${days.map((d) => {
        const desc = describe(info.get(d), bills.get(d));
        return html`<button
          type="button"
          key=${d}
          class=${`month-cell ${d.slice(0, 7) !== day.slice(0, 7) ? 'is-out' : ''} ${d === today ? 'is-today' : ''} ${d === day ? 'is-selected' : ''}`}
          aria-pressed=${d === day ? 'true' : 'false'}
          aria-label=${`${formatLongDate(d)}${desc ? `: ${desc}` : ''}`}
          onClick=${() => onPick(d)}
        >
          <span>${Number(d.slice(8))}</span>
          <${Marks} info=${info.get(d)} bills=${bills.get(d)} />
        </button>`;
      })}
    </div>
  </div>`;
}

function SearchPanel({ s, today }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const results = useMemo(() => {
    const opts = { kind: 'all', status: 'all' };
    if (filter === 'event' || filter === 'task') opts.kind = filter;
    if (filter === 'pending') {
      opts.kind = 'task';
      opts.status = 'pending';
    }
    if (filter === 'done') {
      opts.kind = 'task';
      opts.status = 'done';
    }
    return searchAgenda(s.events, query, opts);
  }, [s.events, query, filter]);
  return html`<div class="stack">
    <label class="search">
      <span class="sr-only">Buscar na agenda</span>
      <${Icon} name="search" size=${18} />
      <input class="input" type="search" placeholder="Buscar por nome, local ou nota" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} autofocus enterkeyhint="search" />
    </label>
    <${Chips} label="Filtro" options=${FILTERS} value=${filter} onChange=${(v) => setFilter(v || 'all')} wrap=${false} />
    ${results.length === 0
      ? html`<${Empty} icon="search" title="Nada encontrado" text=${query ? `Nenhum item com “${query}”.` : 'Nenhum item com este filtro.'} />`
      : html`<div class="list">
          ${results.slice(0, 100).map((item) => {
            const date = item.repeat && item.repeat !== 'none' ? nextOccurrence(item, today) || item.date : item.date;
            const done = item.kind === 'task' && (item.repeat && item.repeat !== 'none' ? (item.doneDates || []).includes(date) : item.done);
            return html`<${AgendaRow} key=${item.id} occ=${{ key: item.id, item, date, done }} showDate />`;
          })}
        </div>`}
  </div>`;
}

export function AgendaView({ s, params }) {
  const today = todayISO();
  const day = isValidISODate(params.dia) ? params.dia : today;
  const mode = MODES.some((m) => m.id === params.modo) ? params.modo : 'dia';
  const searching = params.busca === '1';
  const go = (patch) => setParams({ ...params, ...patch });
  const pick = (d) => go({ dia: d });

  const step = (dir) => {
    if (mode === 'dia') pick(addDays(day, dir));
    else if (mode === 'semana') pick(addDays(day, 7 * dir));
    else pick(addMonths(startOfMonth(day), dir));
  };

  const start = startOfWeek(day);
  const end = endOfWeek(day);
  const title =
    mode === 'dia'
      ? capitalize(relativeDay(day, today))
      : mode === 'semana'
        ? start.slice(0, 7) === end.slice(0, 7)
          ? `${Number(start.slice(8))} a ${Number(end.slice(8))} de ${MONTHS_SHORT[parseISODate(end).getMonth()]}`
          : `${Number(start.slice(8))} ${MONTHS_SHORT[parseISODate(start).getMonth()]} a ${Number(end.slice(8))} ${MONTHS_SHORT[parseISODate(end).getMonth()]}`
        : capitalize(formatMonthYear(day));
  const subtitle = mode === 'dia' ? formatLongDate(day) : '';
  const isCurrent = mode === 'dia' ? day === today : mode === 'semana' ? today >= start && today <= end : day.slice(0, 7) === today.slice(0, 7);

  return html`<div class="view stack">
    <header class="page-head">
      <div>
        <h1 class="page-title">Agenda</h1>
        <p class="page-sub">Compromissos, tarefas e vencimentos</p>
      </div>
      <${IconButton}
        icon=${searching ? 'x' : 'search'}
        label=${searching ? 'Fechar busca' : 'Buscar na agenda'}
        onClick=${() => go({ busca: searching ? '' : '1' })}
      />
    </header>

    ${searching
      ? html`<${SearchPanel} s=${s} today=${today} />`
      : html`
          <${Segmented} label="Visualização" options=${MODES} value=${mode} onChange=${(m) => go({ modo: m })} />
          <div class="day-nav">
            <${IconButton} icon="chevron-left" label="Anterior" onClick=${() => step(-1)} />
            <div class="day-nav-title" aria-live="polite">
              ${title}
              ${subtitle && html`<small>${subtitle}</small>`}
            </div>
            ${!isCurrent
              ? html`<button type="button" class="link-btn" onClick=${() => pick(today)} style=${{ paddingRight: '10px' }}><span>Hoje</span></button>`
              : null}
            <${IconButton} icon="chevron-right" label="Próximo" onClick=${() => step(1)} />
          </div>
          ${mode === 'dia' &&
          html`<${WeekStrip} s=${s} day=${day} today=${today} onPick=${pick} />
            <div class="card"><${DayList} s=${s} day=${day} today=${today} /></div>`}
          ${mode === 'semana' && html`<div class="card"><${WeekView} s=${s} day=${day} today=${today} /></div>`}
          ${mode === 'mes' &&
          html`<${MonthGrid} s=${s} day=${day} today=${today} onPick=${pick} />
            <div class="card">
              <h2 class="card-title" style=${{ marginBottom: '6px' }}>${capitalize(formatLongDate(day))}</h2>
              <${DayList} s=${s} day=${day} today=${today} />
            </div>`}
        `}
  </div>`;
}
