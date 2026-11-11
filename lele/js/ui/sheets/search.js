// Buscar em todos os cartões.
import { html, useMemo, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import { normalize, plainText } from '../../core/rich.js';
import { noteTitle, noteSubtitle } from '../../core/notes.js';
import { openSheet, SheetParts } from '../state.js';
import { Icon } from '../components.js';
import { openEditor } from './editor.js';

export function openSearch() {
  openSheet(({ close }) => html`<${Search} close=${close} />`, { label: 'Buscar cartões' });
}

function Search({ close }) {
  const [q, setQ] = useState('');
  const decks = store.getState().decks;
  const notes = store.list('notes');
  const results = useMemo(() => {
    const term = normalize(q.trim());
    if (term.length < 2) return [];
    return notes
      .filter((n) => normalize(`${plainText(n.front)} ${plainText(n.back)} ${plainText(n.extra)}`).includes(term))
      .slice(0, 60);
  }, [q, notes]);

  return html`<${SheetParts} title="Buscar cartões" close=${close}>
    <div class="search">
      <${Icon} name="search" />
      <input
        type="search"
        value=${q}
        onInput=${(e) => setQ(e.currentTarget.value)}
        placeholder="Palavra da pergunta ou da resposta"
        autofocus
        aria-label="Buscar"
      />
    </div>
    ${q.trim().length >= 2 && !results.length && html`<p class="muted" style="text-align:center;margin-top:20px">Nada encontrado para “${q}”.</p>`}
    <div class="note-list">
      ${results.map((n) => {
        const d = decks[n.deckId];
        return html`<button class="note" onClick=${() => openEditor({ noteId: n.id })}>
          <span class="note__body">
            <span class="note__title">${noteTitle(n)}</span>
            <span class="note__sub">${d && !d.deleted ? `${d.emoji} ${d.name} · ` : ''}${noteSubtitle(n)}</span>
          </span>
        </button>`;
      })}
    </div>
  <//>`;
}
