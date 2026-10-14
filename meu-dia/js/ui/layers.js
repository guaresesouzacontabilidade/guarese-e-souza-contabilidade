// Renderiza painéis, diálogos de confirmação e avisos rápidos.
import { html, useEffect, useRef } from '../vendor/preact.js';
import { useLayers, closeLayer, answerDialog, useToasts, dismissToast, useStore } from './state.js';
import { Icon } from './components.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const initial = el.querySelector('[autofocus]') || el.querySelector('[data-autofocus]');
    // Em telas de toque, não abre o teclado sozinho a menos que o campo peça.
    setTimeout(() => (initial || el).focus({ preventScroll: true }), 60);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLayer();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [active]);
}

// Arrastar para baixo fecha o painel (no celular).
function useSwipeToClose(sheetRef, gripRef) {
  useEffect(() => {
    const grip = gripRef.current;
    const sheet = sheetRef.current;
    if (!grip || !sheet) return undefined;
    let startY = null;
    let dy = 0;
    const down = (e) => {
      startY = e.clientY;
      dy = 0;
      grip.setPointerCapture(e.pointerId);
      sheet.style.transition = 'none';
    };
    const move = (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      if (startY === null) return;
      startY = null;
      sheet.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
      if (dy > 110) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(closeLayer, 160);
      } else {
        sheet.style.transform = '';
      }
    };
    grip.addEventListener('pointerdown', down);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    return () => {
      grip.removeEventListener('pointerdown', down);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
  }, []);
}

function Sheet({ layer, isTop }) {
  const ref = useRef(null);
  const grip = useRef(null);
  useFocusTrap(ref, isTop);
  useSwipeToClose(ref, grip);
  return html`<div class="layer" style=${{ zIndex: 100 + layer.id }}>
    <div class="scrim" onClick=${closeLayer}></div>
    <div class="sheet" ref=${ref} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <div class="sheet-grip" ref=${grip} aria-hidden="true"></div>
      <div class="sheet-scroll" key=${layer.key || layer.id}>${layer.render(closeLayer)}</div>
    </div>
  </div>`;
}

function Dialog({ layer, isTop }) {
  const ref = useRef(null);
  useFocusTrap(ref, isTop);
  return html`<div class="layer is-dialog" style=${{ zIndex: 100 + layer.id }}>
    <div class="scrim" onClick=${() => answerDialog(layer.id, layer.cancelValue)}></div>
    <div class="dialog" ref=${ref} role="alertdialog" aria-modal="true" aria-labelledby=${`dlg-${layer.id}`} aria-describedby=${layer.message ? `dlg-msg-${layer.id}` : undefined} tabindex="-1">
      <div class=${`dialog-icon ${layer.danger ? 'is-danger' : ''}`}>
        <${Icon} name=${layer.icon} size=${24} />
      </div>
      <h2 id=${`dlg-${layer.id}`}>${layer.title}</h2>
      ${layer.message && html`<p id=${`dlg-msg-${layer.id}`}>${layer.message}</p>`}
      <div class="dialog-actions">
        ${layer.options.map(
          (o, i) => html`<button
            type="button"
            key=${i}
            class=${`btn btn-lg btn-${o.variant || 'secondary'}`}
            data-autofocus=${i === 0 ? '' : undefined}
            onClick=${() => answerDialog(layer.id, o.value)}
          >
            ${o.label}
          </button>`,
        )}
      </div>
    </div>
  </div>`;
}

export function Layers() {
  const layers = useLayers();
  useStore(); // painéis abertos refletem mudanças nos dados

  useEffect(() => {
    document.body.classList.toggle('is-locked', layers.length > 0);
    const main = document.getElementById('app-shell');
    if (main) main.inert = layers.length > 0;
  }, [layers.length]);
  return html`${layers.map((layer, i) => {
    const isTop = i === layers.length - 1;
    return layer.type === 'dialog'
      ? html`<${Dialog} key=${layer.id} layer=${layer} isTop=${isTop} />`
      : html`<${Sheet} key=${layer.id} layer=${layer} isTop=${isTop} />`;
  })}`;
}

export function Toasts() {
  const toasts = useToasts();
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map(
      (t) => html`<div class="toast" key=${t.id}>
        <${Icon} name=${t.tone === 'success' ? 'circle-check' : t.tone === 'warning' ? 'triangle-alert' : t.tone === 'reminder' ? 'bell' : 'info'} size=${20} />
        <span class="grow">${t.message}</span>
        ${t.action &&
        html`<button
          type="button"
          class="toast-action"
          onClick=${() => {
            dismissToast(t.id);
            t.action.onClick();
          }}
        >
          ${t.action.label}
        </button>`}
      </div>`,
    )}
  </div>`;
}
