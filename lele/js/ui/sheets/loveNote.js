// Recado escondido (configurado em js/personal.js).
import { html } from '../../vendor/preact.js';
import { LOVE_NOTE } from '../../personal.js';
import { openSheet, SheetParts } from '../state.js';
import { confetti } from '../../services/fx.js';

export const loveNoteAvailable = () => Boolean(LOVE_NOTE.text?.trim());

export function openLoveNote() {
  setTimeout(() => confetti({ count: 60 }), 250);
  openSheet(
    ({ close }) => html`<${SheetParts} title="Um recado pra você 💌" close=${close}>
      <div class="love-note">
        ${LOVE_NOTE.text}
        ${LOVE_NOTE.from && html`<div class="love-note__from">— ${LOVE_NOTE.from}</div>`}
      </div>
    <//>`,
    { label: 'Recado' },
  );
}
