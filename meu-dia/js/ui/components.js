// Componentes visuais reutilizáveis.
import { html, useState, useRef, useEffect, useId } from '../vendor/preact.js';
import { ICONS } from '../vendor/icons.js';
import { formatMoney, formatAmount, digitsToCents } from '../core/money.js';
import { getState, updatePrefs } from '../data/store.js';
import { todayISO, addDays } from '../core/dates.js';
import { motionReduced } from './fx.js';

export function Icon({ name, size = 22, className = '', label }) {
  const inner = ICONS[name] || ICONS.circle;
  return html`<svg
    class=${`icon ${className}`}
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden=${label ? undefined : 'true'}
    role=${label ? 'img' : undefined}
    aria-label=${label}
    dangerouslySetInnerHTML=${{ __html: inner }}
  ></svg>`;
}

// Valor em reais que respeita a opção "ocultar valores".
export function Money({ value, signed = false, className = '', forceShow = false }) {
  const hidden = getState().prefs.hideValues && !forceShow;
  if (hidden) return html`<span class=${`money is-hidden ${className}`} aria-label="valor oculto">R$ •••••</span>`;
  return html`<span class=${`money ${className}`}>${formatMoney(value, { signed })}</span>`;
}

// Valor que "corre" até o número novo (saldo do Início). Leitores de tela recebem só o valor final.
export function AnimatedMoney({ value, className = '' }) {
  const hidden = getState().prefs.hideValues;
  const still = motionReduced();
  const from = useRef(still ? value : 0);
  const [shown, setShown] = useState(from.current);
  useEffect(() => {
    const a = from.current;
    if (motionReduced() || a === value) {
      from.current = value;
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / 750);
      const v = Math.round(a + (value - a) * (1 - (1 - k) ** 4));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (hidden) return html`<${Money} value=${value} className=${className} />`;
  return html`<span class=${`money money-anim ${className}`}><span aria-hidden="true">${formatMoney(shown)}</span><span class="sr-only">${formatMoney(value)}</span></span>`;
}

export function HideValuesButton({ className = '' }) {
  const hidden = getState().prefs.hideValues;
  return html`<button
    type="button"
    class=${`icon-btn ${className}`}
    aria-pressed=${hidden ? 'true' : 'false'}
    aria-label=${hidden ? 'Mostrar valores' : 'Ocultar valores'}
    title=${hidden ? 'Mostrar valores' : 'Ocultar valores'}
    onClick=${() => updatePrefs({ hideValues: !hidden })}
  >
    <${Icon} name=${hidden ? 'eye-off' : 'eye'} />
  </button>`;
}

export function Button({ variant = 'primary', icon, children, className = '', size = '', block = false, ...rest }) {
  return html`<button
    type="button"
    class=${`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`}
    ...${rest}
  >
    ${icon && html`<${Icon} name=${icon} size=${20} />`}
    ${children && html`<span>${children}</span>`}
  </button>`;
}

export function IconButton({ icon, label, className = '', size = 22, ...rest }) {
  return html`<button type="button" class=${`icon-btn ${className}`} aria-label=${label} title=${label} ...${rest}>
    <${Icon} name=${icon} size=${size} />
  </button>`;
}

export function Card({ title, icon, action, children, className = '', style, as = 'section', id }) {
  const Tag = as;
  return html`<${Tag} class=${`card ${className}`} style=${style} id=${id} aria-label=${title || undefined}>
    ${(title || action) &&
    html`<header class="card-head">
      ${title && html`<h2 class="card-title">${icon && html`<${Icon} name=${icon} size=${18} />`}${title}</h2>`}
      ${action}
    </header>`}
    ${children}
  </${Tag}>`;
}

export function LinkButton({ children, onClick, icon = 'chevron-right', ...rest }) {
  return html`<button type="button" class="link-btn" onClick=${onClick} ...${rest}>
    <span>${children}</span><${Icon} name=${icon} size=${16} />
  </button>`;
}

export function Segmented({ options, value, onChange, label, className = '' }) {
  return html`<div class=${`segmented ${className}`} role="tablist" aria-label=${label}>
    ${options.map(
      (o) => html`<button
        type="button"
        role="tab"
        key=${o.id}
        aria-selected=${o.id === value ? 'true' : 'false'}
        class=${o.id === value ? 'is-active' : ''}
        onClick=${() => onChange(o.id)}
      >
        ${o.icon && html`<${Icon} name=${o.icon} size=${18} />`}${o.label}
      </button>`,
    )}
  </div>`;
}

export function Chips({ options, value, onChange, multiple = false, label, className = '', wrap = true }) {
  const selected = (id) => (multiple ? (value || []).includes(id) : value === id);
  const toggle = (id) => {
    if (!multiple) return onChange(value === id ? null : id);
    const set = new Set(value || []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange([...set]);
  };
  return html`<div class=${`chips ${wrap ? '' : 'chips-scroll'} ${className}`} role="group" aria-label=${label}>
    ${options.map(
      (o) => html`<button
        type="button"
        key=${String(o.id)}
        class=${`chip ${selected(o.id) ? 'is-active' : ''}`}
        aria-pressed=${selected(o.id) ? 'true' : 'false'}
        onClick=${() => toggle(o.id)}
      >
        ${o.icon && html`<${Icon} name=${o.icon} size=${16} />`}${o.label}
      </button>`,
    )}
  </div>`;
}

export function Field({ label, hint, children, error, id, className = '' }) {
  return html`<div class=${`field ${className}`}>
    ${label && html`<label class="field-label" for=${id}>${label}</label>`}
    ${children}
    ${error ? html`<p class="field-error" role="alert">${error}</p>` : hint && html`<p class="field-hint">${hint}</p>`}
  </div>`;
}

export function TextInput({ label, hint, error, value, onInput, className = '', inputRef, ...rest }) {
  const id = useId();
  return html`<${Field} label=${label} hint=${hint} error=${error} id=${id} className=${className}>
    <input
      id=${id}
      ref=${inputRef}
      class="input"
      value=${value ?? ''}
      onInput=${(e) => onInput(e.currentTarget.value)}
      aria-invalid=${error ? 'true' : undefined}
      ...${rest}
    />
  </${Field}>`;
}

export function TextArea({ label, hint, value, onInput, rows = 3, ...rest }) {
  const id = useId();
  return html`<${Field} label=${label} hint=${hint} id=${id}>
    <textarea id=${id} class="input textarea" rows=${rows} value=${value ?? ''} onInput=${(e) => onInput(e.currentTarget.value)} ...${rest}></textarea>
  </${Field}>`;
}

export function Select({ label, hint, value, onChange, options, ...rest }) {
  const id = useId();
  return html`<${Field} label=${label} hint=${hint} id=${id}>
    <div class="select-wrap">
      <select id=${id} class="input select" value=${value ?? ''} onChange=${(e) => onChange(e.currentTarget.value)} ...${rest}>
        ${options.map((o) => html`<option key=${String(o.id)} value=${o.id ?? ''}>${o.label}</option>`)}
      </select>
      <${Icon} name="chevron-down" size=${18} className="select-caret" />
    </div>
  </${Field}>`;
}

// Campo de valor estilo app de banco: digita os números e os centavos se ajustam.
export function MoneyInput({ label = 'Valor', value, onChange, error, autoFocus = false, big = false, allowNegative = false, hint }) {
  const id = useId();
  const ref = useRef(null);
  const negative = value < 0;
  const display = value ? formatAmount(Math.abs(value)) : '';
  useEffect(() => {
    if (autoFocus && ref.current) setTimeout(() => ref.current?.focus({ preventScroll: true }), 280);
  }, []);
  const onInput = (e) => {
    const cents = digitsToCents(e.currentTarget.value);
    onChange(negative ? -cents : cents);
    // mantém o cursor no fim
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el && document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  return html`<${Field} label=${label} error=${error} hint=${hint} id=${id} className=${big ? 'field-money-big' : ''}>
    <div class=${`money-input ${big ? 'is-big' : ''} ${error ? 'has-error' : ''}`}>
      ${allowNegative &&
      html`<button type="button" class="sign-btn" aria-label=${negative ? 'Valor negativo; tocar para positivo' : 'Valor positivo; tocar para negativo'} onClick=${() => onChange(-value)}>
        ${negative ? '−' : '+'}
      </button>`}
      <span class="money-prefix" aria-hidden="true">R$</span>
      <input
        id=${id}
        ref=${ref}
        class="money-field"
        inputmode="numeric"
        autocomplete="off"
        enterkeyhint="next"
        placeholder="0,00"
        value=${display}
        onInput=${onInput}
        aria-invalid=${error ? 'true' : undefined}
      />
    </div>
  </${Field}>`;
}

// Data com atalhos (Hoje / Amanhã / Ontem) + seletor nativo.
export function DateField({ label = 'Data', value, onChange, past = false, error }) {
  const id = useId();
  const today = todayISO();
  const quick = past
    ? [{ id: today, label: 'Hoje' }, { id: addDays(today, -1), label: 'Ontem' }]
    : [{ id: today, label: 'Hoje' }, { id: addDays(today, 1), label: 'Amanhã' }];
  return html`<${Field} label=${label} id=${id} error=${error}>
    <div class="date-row">
      ${quick.map(
        (q) => html`<button type="button" key=${q.id} class=${`chip ${value === q.id ? 'is-active' : ''}`} aria-pressed=${value === q.id ? 'true' : 'false'} onClick=${() => onChange(q.id)}>${q.label}</button>`,
      )}
      <input id=${id} type="date" class="input date-input" value=${value} onInput=${(e) => e.currentTarget.value && onChange(e.currentTarget.value)} required />
    </div>
  </${Field}>`;
}

export function Toggle({ label, description, checked, onChange, id: givenId }) {
  const auto = useId();
  const id = givenId || auto;
  return html`<label class="toggle-row" for=${id}>
    <span class="toggle-text">
      <span class="toggle-label">${label}</span>
      ${description && html`<span class="toggle-desc">${description}</span>`}
    </span>
    <input id=${id} type="checkbox" role="switch" class="toggle" checked=${checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
  </label>`;
}

export function Empty({ icon = 'sparkles', title, text, action }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${26} /></div>
    <p class="empty-title">${title}</p>
    ${text && html`<p class="empty-text">${text}</p>`}
    ${action}
  </div>`;
}

// Anel de progresso (orçamento do mês). Enche ao aparecer.
export function Ring({ ratio, level = 'ok', size = 84, stroke = 9, label, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(motionReduced() ? ratio : 0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(ratio));
    return () => cancelAnimationFrame(id);
  }, [ratio]);
  const pct = Math.max(0, Math.min(1, shown || 0));
  const mid = size / 2;
  return html`<div
    class=${`ring is-${level}`}
    style=${{ width: `${size}px`, height: `${size}px` }}
    role="meter"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${Math.round((ratio || 0) * 100)}
    aria-label=${label}
  >
    <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
      <circle class="ring-track" cx=${mid} cy=${mid} r=${r} stroke-width=${stroke} />
      <circle
        class="ring-fill"
        cx=${mid}
        cy=${mid}
        r=${r}
        stroke-width=${stroke}
        stroke-dasharray=${c}
        stroke-dashoffset=${c * (1 - pct)}
        transform=${`rotate(-90 ${mid} ${mid})`}
      />
    </svg>
    <span class="ring-label">${children}</span>
  </div>`;
}

export function Meter({ ratio, level = 'ok', label }) {
  const pct = Math.max(0, Math.min(1, ratio || 0));
  return html`<div class=${`meter is-${level}`} role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round((ratio || 0) * 100)} aria-label=${label}>
    <div class="meter-fill" style=${{ width: `${pct * 100}%` }}></div>
  </div>`;
}

// Ícone da categoria. Com `hue`, usa a cor própria da categoria (Mercado verde, Transporte azul…).
export function CategoryIcon({ icon, tone = 'neutral', size = 20, hue = null }) {
  if (hue !== null && hue !== undefined) {
    return html`<span class="cat-icon has-hue" style=${{ '--h': hue }} aria-hidden="true"><${Icon} name=${icon} size=${size} /></span>`;
  }
  return html`<span class=${`cat-icon tone-${tone}`} aria-hidden="true"><${Icon} name=${icon} size=${size} /></span>`;
}

// Explicação curta para funções que não são óbvias.
export function Hint({ children, icon = 'info' }) {
  return html`<p class="hint"><${Icon} name=${icon} size=${16} /><span>${children}</span></p>`;
}

export function Details({ summary, children, open = false }) {
  const [isOpen, setOpen] = useState(open);
  return html`<div class=${`more ${isOpen ? 'is-open' : ''}`}>
    <button type="button" class="more-toggle" aria-expanded=${isOpen ? 'true' : 'false'} onClick=${() => setOpen(!isOpen)}>
      <${Icon} name=${isOpen ? 'chevron-up' : 'chevron-down'} size=${18} />
      <span>${summary}</span>
    </button>
    ${isOpen && html`<div class="more-body">${children}</div>`}
  </div>`;
}

export function SheetHeader({ title, onClose, subtitle }) {
  return html`<header class="sheet-head">
    <div>
      <h2 class="sheet-title" id="sheet-title">${title}</h2>
      ${subtitle && html`<p class="sheet-subtitle">${subtitle}</p>`}
    </div>
    <${IconButton} icon="x" label="Fechar" onClick=${onClose} />
  </header>`;
}

export function SheetActions({ children }) {
  return html`<div class="sheet-actions">${children}</div>`;
}
