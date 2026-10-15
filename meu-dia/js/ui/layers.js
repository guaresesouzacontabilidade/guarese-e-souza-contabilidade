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

// Arrastar para baixo pelo topo do painel (alça ou título) fecha; um peteleco rápido também.
function useSwipeToClose(sheetRef, scrimRef) {
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    let start = null;
    let dy = 0;
    let dragging = false;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    const down = (e) => {
      if (!e.target.closest('.sheet-grip, .sheet-head') || e.target.closest('button, a, input, select, textarea')) return;
      start = { y: e.clientY, id: e.pointerId };
      dy = 0;
      dragging = false;
      lastY = e.clientY;
      lastT = e.timeStamp;
      speed = 0;
    };
    const move = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const d = e.clientY - start.y;
      if (!dragging) {
        if (d < 6) return;
        dragging = true;
        sheet.setPointerCapture?.(e.pointerId);
        sheet.style.transition = 'none';
      }
      dy = Math.max(0, d);
      const dt = e.timeStamp - lastT;
      if (dt > 0) speed = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      sheet.style.transform = `translateY(${dy}px)`;
      const scrim = scrimRef.current;
      if (scrim) {
        scrim.style.transition = 'none';
        scrim.style.opacity = String(Math.max(0.15, 1 - dy / (sheet.offsetHeight || 600)));
      }
    };
    const up = (e) => {
      if (!start || (e && e.pointerId !== start.id)) return;
      start = null;
      if (!dragging) return;
      dragging = false;
      const scrim = scrimRef.current;
      sheet.style.transition = 'transform 240ms cubic-bezier(.2,.8,.2,1)';
      if (scrim) scrim.style.transition = 'opacity 220ms';
      if (dy > Math.min(150, sheet.offsetHeight * 0.3) || (speed > 0.55 && dy > 24)) {
        sheet.style.transform = 'translateY(105%)';
        if (scrim) scrim.style.opacity = '0';
        setTimeout(closeLayer, 170);
      } else {
        sheet.style.transform = '';
        if (scrim) scrim.style.opacity = '';
      }
    };
    sheet.addEventListener('pointerdown', down);
    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', up);
    sheet.addEventListener('pointercancel', up);
    return () => {
      sheet.removeEventListener('pointerdown', down);
      sheet.removeEventListener('pointermove', move);
      sheet.removeEventListener('pointerup', up);
      sheet.removeEventListener('pointercancel', up);
    };
  }, []);
}

function Sheet({ layer, isTop }) {
  const ref = useRef(null);
  const scrim = useRef(null);
  useFocusTrap(ref, isTop);
  useSwipeToClose(ref, scrim);
  return html`<div class="layer" style=${{ zIndex: 100 + layer.id }}>
    <div class="scrim" ref=${scrim} onClick=${closeLayer}></div>
    <div class="sheet" ref=${ref} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <div class="sheet-grip" aria-hidden="true"></div>
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
