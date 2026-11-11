// Início: o que estudar hoje, sequência de dias e baralhos.
import { html, useEffect, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { greeting } from '../../core/dates.js';
import { formatDuration } from '../../core/stats.js';
import { fetchIndex, pendingPacks, installPack } from '../../data/packs.js';
import { navigate, toast } from '../state.js';
import { Icon, IconButton, Counts, plural } from '../components.js';
import { summary, groupedDecks } from '../summary.js';
import { openDeckForm } from '../sheets/deckForm.js';
import { openImport } from '../sheets/import.js';
import { openSearch } from '../sheets/search.js';
import { isIOS, isStandalone } from '../../services/install.js';

export function HomeView() {
  const settings = store.settings();
  const sum = summary();
  const groups = groupedDecks();
  const hasDecks = groups.length > 0;
  const name = settings.name || 'Lelé';

  return html`<section class="view">
    <header class="hello">
      <div>
        <p class="hello__kicker">${greeting()},</p>
        <h1 class="hello__name"><em>${name}</em><span class="hello__heart" aria-hidden="true">💗</span></h1>
      </div>
      <div class="hello__actions">
        ${hasDecks && html`<${IconButton} icon="search" label="Buscar cartões" filled onClick=${openSearch} />`}
      </div>
    </header>

    ${hasDecks && html`<${TodayHero} sum=${sum} />`}
    ${hasDecks && html`<${StatsRow} sum=${sum} />`}

    <${InstallBanner} />
    <${PacksBanner} />

    <div class="section">
      <div class="section__head">
        <h2 class="section__title">Baralhos</h2>
        ${hasDecks &&
        html`<div class="section__actions">
          <button class="btn btn--ghost btn--sm" onClick=${() => openImport()}><${Icon} name="file-up" size="sm" /> Importar</button>
          <button class="btn btn--soft btn--sm" onClick=${() => openDeckForm()}><${Icon} name="plus" size="sm" /> Novo</button>
        </div>`}
      </div>
      ${hasDecks
        ? groups.map(
            ([group, decks]) => html`
              ${group && html`<h3 class="group-label">${group}</h3>`}
              <div class="deck-list">${decks.map((d) => html`<${DeckRow} key=${d.id} deck=${d} info=${sum.perDeck.get(d.id)} />`)}</div>
            `,
          )
        : html`<div class="empty">
            <div class="empty__art">📚</div>
            <h3 class="empty__title">Nenhum baralho ainda</h3>
            <p class="empty__text">Crie um baralho por matéria (Cardiologia, Farmacologia…) ou importe uma lista pronta.</p>
            <div class="empty__actions">
              <button class="btn btn--primary" onClick=${() => openDeckForm()}><${Icon} name="plus" /> Criar baralho</button>
              <button class="btn btn--secondary" onClick=${() => openImport()}><${Icon} name="file-up" /> Importar</button>
            </div>
          </div>`}
    </div>
  </section>`;
}

function TodayHero({ sum }) {
  const { due, dueTotal } = sum;
  if (!dueTotal) {
    const tomorrowMsg = sum.newTotal && !sum.newLimit
      ? 'Você já viu todos os cartões novos de hoje. Amanhã tem mais!'
      : 'Nenhum cartão para revisar agora. Aproveite o descanso!';
    return html`<div class="hero">
      <p class="hero__label">Hoje</p>
      <p class="hero__done">Tudo em dia! 🎉</p>
      <p style="margin:0 0 16px;opacity:.9">${tomorrowMsg}</p>
      <button class="btn btn--light" onClick=${() => navigate('/progresso')}><${Icon} name="chart-column" /> Ver progresso</button>
    </div>`;
  }
  return html`<div class="hero">
    <p class="hero__label">Para hoje</p>
    <div class="hero__big">
      <span class="hero__number">${dueTotal}</span>
      <span class="hero__unit">${dueTotal === 1 ? 'cartão' : 'cartões'}</span>
    </div>
    <div class="hero__split">
      ${due.fresh > 0 && html`<span class="hero__pill"><i></i>${plural(due.fresh, 'novo', 'novos')}</span>`}
      ${due.learning > 0 && html`<span class="hero__pill"><i></i>${due.learning} aprendendo</span>`}
      ${due.review > 0 && html`<span class="hero__pill"><i></i>${due.review} para revisar</span>`}
    </div>
    <button class="btn btn--light btn--block" onClick=${() => navigate('/estudar')}>
      <${Icon} name="play" /> Estudar agora
    </button>
  </div>`;
}

function StatsRow({ sum }) {
  const st = sum.streak.current;
  return html`<div class="stats-row">
    <div class="stat stat--flame">
      <div class="stat__value"><${Icon} name="flame" /> ${st}</div>
      <div class="stat__label">${st === 1 ? 'dia seguido' : 'dias seguidos'}</div>
    </div>
    <div class="stat">
      <div class="stat__value">${sum.today.reviews}</div>
      <div class="stat__label">${sum.today.ms ? formatDuration(sum.today.ms) + ' hoje' : 'cartões hoje'}</div>
    </div>
    <div class="stat">
      <div class="stat__value">${sum.retention.pct == null ? '—' : `${sum.retention.pct}%`}</div>
      <div class="stat__label">de acertos</div>
    </div>
  </div>`;
}

function DeckRow({ deck, info }) {
  const due = info?.due || { fresh: 0, learning: 0, review: 0 };
  const cards = info?.cards || { total: 0 };
  const total = cards.total || 0;
  const seen = total - (cards.new || 0);
  return html`<button class="deck" style=${`--deck-color:${deck.color}`} onClick=${() => navigate(`/baralho/${deck.id}`)}>
    <span class="deck__emoji">${deck.emoji || '📚'}</span>
    <span class="deck__body">
      <span class="deck__name">${deck.name}</span>
      <span class="deck__meta">${total ? `${plural(total, 'cartão', 'cartões')} · ${Math.round((seen / total) * 100)}% visto` : 'Vazio'}</span>
      ${total > 0 &&
      html`<span class="deck__bar" aria-hidden="true">
        <span style=${`width:${((cards.mature || 0) / total) * 100}%;background:var(--c-mature)`}></span>
        <span style=${`width:${((cards.young || 0) / total) * 100}%;background:var(--c-young)`}></span>
        <span style=${`width:${((cards.learning || 0) / total) * 100}%;background:var(--c-learn)`}></span>
      </span>`}
    </span>
    ${due.fresh + due.learning + due.review > 0
      ? html`<${Counts} counts=${due} />`
      : total > 0 && html`<span class="deck__check" title="Em dia"><${Icon} name="circle-check" /></span>`}
  </button>`;
}

function InstallBanner() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('lele:hide-install') === '1';
    } catch {
      return false;
    }
  });
  if (hidden || !isIOS() || isStandalone()) return null;
  const hide = () => {
    try {
      localStorage.setItem('lele:hide-install', '1');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  return html`<div class="banner">
    <span class="banner__icon">📲</span>
    <div class="banner__body">
      <div class="banner__title">Coloque o app na tela de início</div>
      <div class="banner__text">No Safari, toque em <b>Compartilhar</b> <${Icon} name="share" size="sm" /> e depois em <b>Adicionar à Tela de Início</b>. Ele abre em tela cheia e funciona sem internet.</div>
      <div class="banner__actions"><button class="btn btn--ghost btn--sm" onClick=${hide}>Entendi</button></div>
    </div>
  </div>`;
}

function PacksBanner() {
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const installed = store.settings().packs;
  useEffect(() => {
    let alive = true;
    fetchIndex().then((idx) => alive && setPending(pendingPacks(idx).filter((p) => !p.starter)));
    return () => {
      alive = false;
    };
  }, [installed]);
  if (!pending.length) return null;
  const p = pending[0];
  const add = async () => {
    setBusy(true);
    try {
      const n = await installPack(p);
      toast(n ? `${plural(n, 'cartão novo', 'cartões novos')} em “${p.title}” 💌` : 'Esse baralho já estava completo.');
      setPending(pending.slice(1));
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="banner">
    <span class="banner__icon">${p.emoji || '💌'}</span>
    <div class="banner__body">
      <div class="banner__title">Chegaram cartões novos: ${p.title}</div>
      <div class="banner__text">${p.description}</div>
      <div class="banner__actions">
        <button class="btn btn--primary btn--sm" disabled=${busy} onClick=${add}>${busy ? 'Adicionando…' : 'Adicionar'}</button>
      </div>
    </div>
  </div>`;
}
