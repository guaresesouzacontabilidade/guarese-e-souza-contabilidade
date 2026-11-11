// Peças reutilizáveis da interface.
import { html } from '../vendor/preact.js';
import { ICONS } from '../vendor/icons.js';
import { useLayers, dismissToast } from './state.js';

export function Icon({ name, size, class: cls = '' }) {
  return html`<svg
    class=${`icon ${size === 'sm' ? 'icon--sm' : ''} ${cls}`}
    viewBox="0 0 24 24"
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}
  ></svg>`;
}

export function IconButton({ icon, label, onClick, filled = false, ...rest }) {
  return html`<button
    type="button"
    class=${`icon-btn ${filled ? 'icon-btn--filled' : ''}`}
    aria-label=${label}
    title=${label}
    onClick=${onClick}
    ...${rest}
  >
    <${Icon} name=${icon} />
  </button>`;
}

export function Switch({ checked, onChange, label }) {
  return html`<button
    type="button"
    class="switch"
    role="switch"
    aria-checked=${checked ? 'true' : 'false'}
    aria-label=${label}
    onClick=${() => onChange(!checked)}
  ></button>`;
}

export function Segmented({ options, value, onChange, label }) {
  return html`<div class="segmented" role="group" aria-label=${label}>
    ${options.map(
      (o) => html`<button type="button" aria-pressed=${o.id === value ? 'true' : 'false'} onClick=${() => onChange(o.id)}>
        ${o.label}
      </button>`,
    )}
  </div>`;
}

export function Stepper({ value, onChange, min = 0, max = 999, step = 1, label }) {
  return html`<div class="stepper" role="group" aria-label=${label}>
    <button type="button" class="icon-btn" aria-label="Diminuir" onClick=${() => onChange(Math.max(min, value - step))}>
      <svg class="icon icon--sm" viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
    </button>
    <output aria-live="polite">${value}</output>
    <button type="button" class="icon-btn" aria-label="Aumentar" onClick=${() => onChange(Math.min(max, value + step))}>
      <${Icon} name="plus" size="sm" />
    </button>
  </div>`;
}

// Contadores coloridos (novos · aprendendo · revisar), como no Anki.
export function Counts({ counts }) {
  const item = (n, cls, label) =>
    html`<span class=${`count ${n ? cls : 'count--zero'}`} title=${label} aria-label=${`${n} ${label}`}>${n}</span>`;
  return html`<span class="counts">
    ${item(counts.fresh, 'count--new', 'novos')} ${item(counts.learning, 'count--learn', 'aprendendo')}
    ${item(counts.review, 'count--review', 'para revisar')}
  </span>`;
}

export function MaturityBar({ counts, class: cls = 'maturity-bar' }) {
  const total = counts.total || 1;
  const seg = (n, color) => (n ? html`<span style=${`width:${(n / total) * 100}%;background:${color}`}></span>` : null);
  return html`<div class=${cls} aria-hidden="true">
    ${seg(counts.mature, 'var(--c-mature)')} ${seg(counts.young, 'var(--c-young)')} ${seg(counts.learning, 'var(--c-learn)')}
    ${seg(counts.new, 'color-mix(in srgb, var(--c-new) 35%, var(--surface-3))')}
  </div>`;
}

export function Toasts() {
  const { toasts } = useLayers();
  return html`<div class="toasts" aria-live="polite">
    ${toasts.map(
      (t) => html`<div class="toast" key=${t.id} role="status">
        <span class="toast__text">${t.text}</span>
        ${t.action &&
        html`<button
          class="toast__action"
          onClick=${() => {
            dismissToast(t.id);
            t.action.fn();
          }}
        >
          ${t.action.label}
        </button>`}
      </div>`,
    )}
  </div>`;
}

export function Sheets() {
  const { sheets } = useLayers();
  return sheets.map(
    (s, i) => html`<div key=${s.id}>
      <div class=${`scrim ${s.closing ? 'is-closing' : ''}`} style=${`z-index:${60 + i * 2}`} onClick=${() => s.close()}></div>
      <div
        class=${`sheet ${s.closing ? 'is-closing' : ''}`}
        style=${`z-index:${61 + i * 2}`}
        role="dialog"
        aria-modal="true"
        aria-label=${s.label || undefined}
      >
        <${s.render} close=${s.close} />
      </div>
    </div>`,
  );
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
