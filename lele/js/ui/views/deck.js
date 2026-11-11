// Um baralho: estudar, números e lista de cartões.
import { html, useMemo, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import * as actions from '../../data/actions.js';
import { cardOrds, cardId, noteTitle, noteSubtitle } from '../../core/notes.js';
import { normalize, plainText } from '../../core/rich.js';
import { maturity } from '../../core/srs.js';
import { back, navigate, toast, confirm, openSheet, SheetParts } from '../state.js';
import { Icon, IconButton, MaturityBar, plural } from '../components.js';
import { summary } from '../summary.js';
import { openEditor } from '../sheets/editor.js';
import { openDeckForm } from '../sheets/deckForm.js';
import { openImport } from '../sheets/import.js';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'new', label: 'Novos' },
  { id: 'hard', label: 'Difíceis' },
  { id: 'paused', label: 'Pausados' },
];

const DOT = {
  new: 'color-mix(in srgb, var(--c-new) 45%, var(--surface-3))',
  learning: 'var(--c-learn)',
  young: 'var(--c-young)',
  mature: 'var(--c-mature)',
};

export function DeckView({ id }) {
  const deck = store.get('decks', id);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(60);
  const s = store.getState();
  const notes = store.list('notes');
  const deckNotes = useMemo(
    () => notes.filter((n) => n.deckId === id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [notes, id],
  );

  if (!deck) {
    return html`<section class="view">
      <div class="topbar"><${IconButton} icon="chevron-left" label="Voltar" onClick=${() => back('/')} /></div>
      <div class="empty"><div class="empty__art">🫥</div><h3 class="empty__title">Baralho não encontrado</h3>
      <p class="empty__text">Ele pode ter sido apagado em outro aparelho.</p>
      <button class="btn btn--primary" onClick=${() => navigate('/', { replace: true })}>Ir para o início</button></div>
    </section>`;
  }

  const info = summary().perDeck.get(id) || { due: { fresh: 0, learning: 0, review: 0 }, cards: { total: 0 } };
  const dueTotal = info.due.fresh + info.due.learning + info.due.review;

  const noteState = (n) => {
    const states = cardOrds(n).map((o) => s.cards[cardId(n.id, o)]);
    const lapses = Math.max(0, ...states.map((c) => c?.lapses || 0));
    const ease = Math.min(9, ...states.map((c) => (c && c.state !== 'new' ? c.ease : 9)));
    const order = ['learning', 'young', 'mature', 'new'];
    const mats = states.map(maturity);
    const mat = order.find((m) => mats.includes(m)) || 'new';
    return { lapses, ease, mat, isNew: mats.every((m) => m === 'new') };
  };

  const term = normalize(q.trim());
  const filtered = deckNotes.filter((n) => {
    if (term && !normalize(`${plainText(n.front)} ${plainText(n.back)} ${plainText(n.extra)}`).includes(term)) return false;
    if (filter === 'paused') return n.suspended;
    if (filter === 'new') return noteState(n).isNew;
    if (filter === 'hard') {
      const st = noteState(n);
      return st.lapses >= 2 || st.ease < 2.1;
    }
    return true;
  });

  function menu() {
    openSheet(
      ({ close }) => html`<${SheetParts} title=${deck.name} close=${close}>
        <div class="list">
          <button class="row" onClick=${() => { close(); openDeckForm({ deckId: id }); }}>
            <span class="row__icon"><${Icon} name="pencil" /></span><span class="row__body"><span class="row__title">Editar baralho</span><span class="row__sub">Nome, grupo, ícone e cor</span></span>
          </button>
          <button class="row" onClick=${() => { close(); openImport({ deckId: id }); }}>
            <span class="row__icon"><${Icon} name="file-up" /></span><span class="row__body"><span class="row__title">Importar cartões</span><span class="row__sub">Colar uma lista ou abrir arquivo</span></span>
          </button>
          <button class="row" onClick=${() => { close(); navigate(`/estudar?modo=treino&deck=${id}`); }}>
            <span class="row__icon"><${Icon} name="shuffle" /></span><span class="row__body"><span class="row__title">Treino livre</span><span class="row__sub">Todos os cartões embaralhados, sem mexer na agenda</span></span>
          </button>
          <button class="row row--danger" onClick=${async () => {
            close();
            const ok = await confirm({
              title: `Apagar “${deck.name}”?`,
              text: `${plural(deckNotes.length, 'cartão será apagado', 'cartões serão apagados')} junto, em todos os aparelhos. Não dá para desfazer.`,
              confirmLabel: 'Apagar baralho',
              danger: true,
            });
            if (!ok) return;
            actions.deleteDeck(id);
            toast('Baralho apagado');
            navigate('/', { replace: true });
          }}>
            <span class="row__icon"><${Icon} name="trash-2" /></span><span class="row__body"><span class="row__title">Apagar baralho</span></span>
          </button>
        </div>
      <//>`,
      { label: 'Opções do baralho' },
    );
  }

  return html`<section class="view">
    <div class="topbar">
      <${IconButton} icon="chevron-left" label="Voltar" onClick=${() => back('/')} />
      <span class="topbar__title"></span>
      <${IconButton} icon="ellipsis" label="Opções do baralho" onClick=${menu} />
    </div>

    <div class="deck-hero" style=${`--deck-color:${deck.color}`}>
      <span class="deck__emoji">${deck.emoji || '📚'}</span>
      <div>
        ${deck.group && html`<div class="deck-hero__group">${deck.group}</div>`}
        <h1 class="deck-hero__name">${deck.name}</h1>
      </div>
    </div>

    <div class="study-card">
      <div class="study-card__counts">
        <div><div class="study-card__n" style="color:var(--c-new)">${info.due.fresh}</div><div class="study-card__l">novos</div></div>
        <div><div class="study-card__n" style="color:var(--c-learn)">${info.due.learning}</div><div class="study-card__l">aprendendo</div></div>
        <div><div class="study-card__n" style="color:var(--c-review)">${info.due.review}</div><div class="study-card__l">para revisar</div></div>
      </div>
      <div class="study-card__actions">
        ${dueTotal
          ? html`<button class="btn btn--primary btn--block" onClick=${() => navigate(`/estudar?deck=${id}`)}><${Icon} name="play" /> Estudar ${plural(dueTotal, 'cartão', 'cartões')}</button>`
          : html`<div class="notice notice--ok"><${Icon} name="circle-check" size="sm" /> ${info.cards.total ? 'Tudo em dia neste baralho!' : 'Adicione cartões para começar.'}</div>`}
        ${info.cards.total > 0 &&
        html`<button class="btn btn--secondary btn--block" onClick=${() => navigate(`/estudar?modo=treino&deck=${id}`)}>
          <${Icon} name="shuffle" /> Treino livre
        </button>`}
      </div>
    </div>

    ${info.cards.total > 0 &&
    html`<div class="section">
      <${MaturityBar} counts=${info.cards} />
      <div class="legend">
        <span><i style="background:var(--c-mature)"></i>${info.cards.mature} dominados</span>
        <span><i style="background:var(--c-young)"></i>${info.cards.young} recentes</span>
        <span><i style="background:var(--c-learn)"></i>${info.cards.learning} aprendendo</span>
        <span><i style=${`background:${DOT.new}`}></i>${info.cards.new} novos</span>
      </div>
    </div>`}

    <div class="section">
      <div class="section__head">
        <h2 class="section__title">Cartões <span class="muted" style="font-size:16px">${deckNotes.length}</span></h2>
        <button class="btn btn--soft btn--sm" onClick=${() => openEditor({ deckId: id })}><${Icon} name="plus" size="sm" /> Novo</button>
      </div>
      ${deckNotes.length > 0
        ? html`
            <div class="search">
              <${Icon} name="search" />
              <input type="search" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} placeholder="Buscar neste baralho" aria-label="Buscar neste baralho" />
            </div>
            <div class="chips" role="group" aria-label="Filtro">
              ${FILTERS.map((f) => html`<button class="chip" aria-pressed=${filter === f.id ? 'true' : 'false'} onClick=${() => setFilter(f.id)}>${f.label}</button>`)}
            </div>
            <div class="note-list">
              ${filtered.slice(0, limit).map((n) => {
                const st = noteState(n);
                return html`<button key=${n.id} class=${`note ${n.suspended ? 'note--suspended' : ''}`} onClick=${() => openEditor({ noteId: n.id })}>
                  <span class="note__dot" style=${`background:${DOT[st.mat]}`} aria-hidden="true"></span>
                  <span class="note__body">
                    <span class="note__title">${noteTitle(n)}</span>
                    <span class="note__sub">${noteSubtitle(n)}</span>
                  </span>
                  ${n.type === 'cloze' && html`<span class="note__tag">lacunas</span>`}
                  ${n.suspended && html`<span class="note__tag">pausado</span>`}
                  ${n.image && html`<${Icon} name="image" size="sm" />`}
                </button>`;
              })}
            </div>
            ${!filtered.length && html`<p class="muted" style="text-align:center;margin-top:18px">Nenhum cartão aqui.</p>`}
            ${filtered.length > limit &&
            html`<div class="more-row"><button class="btn btn--ghost btn--sm" onClick=${() => setLimit(limit + 100)}>Mostrar mais (${filtered.length - limit})</button></div>`}
          `
        : html`<div class="empty">
            <div class="empty__art">✍️</div>
            <h3 class="empty__title">Baralho vazio</h3>
            <p class="empty__text">Crie cartões um a um ou importe uma lista de perguntas e respostas.</p>
            <div class="empty__actions">
              <button class="btn btn--primary" onClick=${() => openEditor({ deckId: id })}><${Icon} name="plus" /> Novo cartão</button>
              <button class="btn btn--secondary" onClick=${() => openImport({ deckId: id })}><${Icon} name="file-up" /> Importar</button>
            </div>
          </div>`}
    </div>
  </section>`;
}
