// Contas a pagar e a receber: vencidas, em breve, próximas e pagas.
import { html, useMemo, useState } from '../../vendor/preact.js';
import { todayISO } from '../../core/dates.js';
import { groupBills, totalAmount, STATE_LABEL } from '../../core/bills.js';
import { Segmented, Empty, Button, Money, Icon, IconButton, Hint } from '../components.js';
import { BillRow } from '../rows.js';
import { SwipeHint } from '../swipe.js';
import { navigate } from '../state.js';
import { openBillForm } from '../forms/bill.js';

const KINDS = [
  { id: 'pay', label: 'A pagar', icon: 'receipt' },
  { id: 'receive', label: 'A receber', icon: 'hand-coins' },
];

function Group({ id, bills, kind, open = true }) {
  const [expanded, setExpanded] = useState(open);
  if (!bills.length) return null;
  const label = id === 'paid' ? (kind === 'receive' ? 'Recebidas' : 'Pagas') : STATE_LABEL[id];
  const shown = expanded ? bills : [];
  return html`<section class="card" aria-label=${label}>
    <h2 class="group-title" style=${{ paddingTop: 0 }}>
      <span style=${{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        ${id === 'overdue' && html`<${Icon} name="triangle-alert" size=${16} />`}
        ${label} · ${bills.length}
      </span>
      ${id === 'paid'
        ? html`<button type="button" class="link-btn" onClick=${() => setExpanded(!expanded)} aria-expanded=${expanded ? 'true' : 'false'}>
            <span>${expanded ? 'Ocultar' : 'Mostrar'}</span><${Icon} name=${expanded ? 'chevron-up' : 'chevron-down'} size=${16} />
          </button>`
        : html`<span class="money"><${Money} value=${totalAmount(bills)} /></span>`}
    </h2>
    ${shown.length > 0 && html`<div class="list">${shown.map((b) => html`<${BillRow} key=${b.id} bill=${b} />`)}</div>`}
  </section>`;
}

export function BillsView({ s, params }) {
  const today = todayISO();
  const kind = params.tipo === 'receive' ? 'receive' : 'pay';
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const groups = useMemo(() => groupBills(s.bills, kind, today, query), [s.bills, kind, today, query]);
  const total = groups.overdue.length + groups.soon.length + groups.upcoming.length + groups.paid.length;
  const open = [...groups.overdue, ...groups.soon, ...groups.upcoming];

  return html`<div class="view stack">
    <header class="page-head">
      <div>
        <h1 class="page-title">Contas</h1>
        <p class="page-sub">${open.length ? html`Em aberto: <${Money} value=${totalAmount(open)} />` : 'O que vence e o que já foi pago'}</p>
      </div>
      <${IconButton} icon=${searching ? 'x' : 'search'} label=${searching ? 'Fechar busca' : 'Buscar contas'} onClick=${() => { setSearching(!searching); setQuery(''); }} />
    </header>

    <${Segmented} label="Tipo de conta" options=${KINDS} value=${kind} onChange=${(k) => navigate(k === 'pay' ? '/contas' : '/contas?tipo=receive')} />

    ${searching &&
    html`<label class="search">
      <span class="sr-only">Buscar contas</span>
      <${Icon} name="search" size=${18} />
      <input class="input" type="search" placeholder="Buscar pelo nome" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} autofocus />
    </label>`}

    ${total === 0
      ? html`<div class="card"><${Empty}
          icon=${kind === 'pay' ? 'receipt' : 'hand-coins'}
          title=${query ? 'Nada encontrado' : kind === 'pay' ? 'Nenhuma conta a pagar' : 'Nada a receber cadastrado'}
          text=${query ? `Nenhuma conta com “${query}”.` : kind === 'pay' ? 'Cadastre luz, aluguel, cartão… e receba lembretes antes do vencimento.' : 'Cadastre valores que alguém vai te pagar para não esquecer de cobrar.'}
          action=${!query && html`<${Button} icon="plus" onClick=${() => openBillForm({ kind })}>${kind === 'pay' ? 'Cadastrar conta a pagar' : 'Cadastrar valor a receber'}</${Button}>`}
        /></div>`
      : html`
          ${open.length > 0 && html`<${SwipeHint} text=${`Dica: arraste uma conta para a direita para marcar como ${kind === 'receive' ? 'recebida' : 'paga'}.`} />`}
          <${Group} id="overdue" bills=${groups.overdue} kind=${kind} />
          <${Group} id="soon" bills=${groups.soon} kind=${kind} />
          <${Group} id="upcoming" bills=${groups.upcoming} kind=${kind} />
          <${Group} id="paid" bills=${groups.paid.slice(0, 50)} kind=${kind} open=${false} />
          ${open.length > 0 && html`<${Hint}>Toque em “${kind === 'pay' ? 'Pagar' : 'Recebi'}” para marcar na hora. Em seguida perguntamos se você quer registrar em Finanças.</${Hint}>`}
          <${Button} variant="secondary" icon="plus" onClick=${() => openBillForm({ kind })}>${kind === 'pay' ? 'Nova conta a pagar' : 'Novo valor a receber'}</${Button}>
        `}
  </div>`;
}
