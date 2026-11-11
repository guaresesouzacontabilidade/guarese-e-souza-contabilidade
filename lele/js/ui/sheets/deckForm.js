// Criar e editar baralhos.
import { html, useState } from '../../vendor/preact.js';
import * as store from '../../data/store.js';
import * as actions from '../../data/actions.js';
import { DECK_COLORS, DECK_EMOJIS } from '../../data/actions.js';
import { openSheet, SheetParts, toast } from '../state.js';

export function openDeckForm({ deckId = null, onSaved } = {}) {
  openSheet(({ close }) => html`<${DeckForm} close=${close} deckId=${deckId} onSaved=${onSaved} />`, {
    label: deckId ? 'Editar baralho' : 'Novo baralho',
  });
}

function DeckForm({ close, deckId, onSaved }) {
  const existing = deckId ? store.get('decks', deckId) : null;
  const groups = [...new Set(store.list('decks').map((d) => d.group).filter(Boolean))].sort();
  const [name, setName] = useState(existing?.name || '');
  const [group, setGroup] = useState(existing?.group || '');
  const [color, setColor] = useState(existing?.color || DECK_COLORS[store.list('decks').length % DECK_COLORS.length]);
  const [emoji, setEmoji] = useState(existing?.emoji || '📚');
  const [error, setError] = useState('');

  function save(e) {
    e?.preventDefault();
    if (!name.trim()) {
      setError('Dê um nome ao baralho.');
      return;
    }
    let deck;
    if (existing) {
      actions.updateDeck(existing.id, { name: name.trim(), group: group.trim(), color, emoji });
      deck = store.get('decks', existing.id);
      toast('Baralho atualizado');
    } else {
      deck = actions.createDeck({ name, group, color, emoji });
      toast(`Baralho “${deck.name}” criado`);
    }
    close();
    onSaved?.(deck);
  }

  return html`<${SheetParts}
    title=${existing ? 'Editar baralho' : 'Novo baralho'}
    close=${close}
    foot=${html`<button class="btn btn--primary" onClick=${save}>${existing ? 'Salvar' : 'Criar baralho'}</button>`}
  >
    <form onSubmit=${save}>
      <label class="field">
        <span class="field__label">Nome</span>
        <input
          class="input"
          value=${name}
          onInput=${(e) => {
            setName(e.currentTarget.value);
            setError('');
          }}
          placeholder="Ex.: Cardiologia"
          autofocus
          maxlength="60"
        />
      </label>
      <label class="field">
        <span class="field__label">Grupo <span class="muted small">opcional</span></span>
        <input
          class="input"
          value=${group}
          onInput=${(e) => setGroup(e.currentTarget.value)}
          placeholder="Ex.: Clínica Médica"
          list="lele-groups"
          maxlength="40"
        />
        <datalist id="lele-groups">${groups.map((g) => html`<option value=${g} />`)}</datalist>
        <p class="field__hint">Baralhos do mesmo grupo aparecem juntos no início.</p>
      </label>
      <div class="field">
        <span class="field__label">Ícone</span>
        <div class="emojis">
          ${DECK_EMOJIS.map(
            (em) => html`<button type="button" class="emoji-btn" aria-pressed=${em === emoji ? 'true' : 'false'} onClick=${() => setEmoji(em)}>
              ${em}
            </button>`,
          )}
        </div>
      </div>
      <div class="field">
        <span class="field__label">Cor</span>
        <div class="swatches">
          ${DECK_COLORS.map(
            (c) => html`<button
              type="button"
              class="swatch"
              style=${`--sw:${c}`}
              aria-label=${`Cor ${c}`}
              aria-pressed=${c === color ? 'true' : 'false'}
              onClick=${() => setColor(c)}
            ></button>`,
          )}
        </div>
      </div>
      ${error && html`<div class="notice notice--warn" role="alert">${error}</div>`}
      <button type="submit" class="sr-only">Salvar</button>
    </form>
  <//>`;
}
