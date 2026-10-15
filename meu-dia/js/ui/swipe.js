// Arrastar uma linha para o lado: para a direita conclui/paga, para a esquerda exclui.
// É um atalho: os botões normais continuam lá, para quem não arrasta ou usa leitor de tela.
import { html, useEffect, useRef } from '../vendor/preact.js';
import { Icon } from './components.js';
import { suppressNextClick, motionReduced } from './fx.js';
import { feedback } from '../services/feedback.js';
import { getState, updatePrefs } from '../data/store.js';

const START = 10; // px antes de decidir se é arrastar para o lado ou rolar a tela
const ARM = 96; // px a partir do qual soltar executa a ação

// right: ação ao arrastar para a direita (aparece à esquerda). left: ao arrastar para a esquerda.
export function Swipe({ right, left, children }) {
  const box = useRef(null);
  const fg = useRef(null);
  const actions = useRef({ right, left });
  actions.current = { right, left };

  useEffect(() => {
    const el = fg.current;
    const wrap = box.current;
    if (!el || !wrap) return undefined;
    let start = null;
    let dx = 0;
    let mode = null; // null | 'swipe' | 'scroll'
    let armed = false;

    let clearDir = 0;
    const set = (x, animate) => {
      el.style.transition = animate ? 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1.2)' : 'none';
      el.style.transform = x ? `translateX(${x}px)` : '';
      clearTimeout(clearDir);
      // Mantém o fundo visível enquanto a linha volta ao lugar.
      if (x) wrap.dataset.dir = x > 0 ? 'right' : 'left';
      else if (animate) clearDir = setTimeout(() => (wrap.dataset.dir = ''), 280);
      else wrap.dataset.dir = '';
    };
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('input, select, textarea, .btn-pay, .check')) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dx = 0;
      mode = null;
      armed = false;
    };
    const move = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const mx = e.clientX - start.x;
      const my = e.clientY - start.y;
      if (!mode) {
        if (Math.abs(my) > START && Math.abs(my) > Math.abs(mx)) mode = 'scroll';
        else if (Math.abs(mx) > START && Math.abs(mx) > Math.abs(my) * 1.2) {
          const dir = mx > 0 ? 'right' : 'left';
          if (!actions.current[dir]) {
            mode = 'scroll';
            return;
          }
          mode = 'swipe';
          el.setPointerCapture?.(e.pointerId);
          wrap.classList.add('is-swiping');
        }
        if (mode !== 'swipe') return;
      }
      if (mode !== 'swipe') return;
      const dir = mx > 0 ? 'right' : 'left';
      if (!actions.current[dir]) {
        dx = 0;
        set(0, false);
        return;
      }
      // Resistência depois do ponto de ação.
      const abs = Math.abs(mx);
      dx = Math.sign(mx) * (abs <= ARM ? abs : ARM + (abs - ARM) * 0.35);
      set(motionReduced() ? Math.sign(mx) * Math.min(abs, ARM + 8) : dx, false);
      const nowArmed = abs >= ARM;
      if (nowArmed !== armed) {
        armed = nowArmed;
        wrap.classList.toggle('is-armed', armed);
        if (armed) feedback('nav');
      }
    };
    const up = (e) => {
      if (!start || (e && e.pointerId !== start.id)) return;
      const wasSwipe = mode === 'swipe';
      const dir = dx > 0 ? 'right' : 'left';
      start = null;
      mode = null;
      wrap.classList.remove('is-swiping', 'is-armed');
      if (!wasSwipe) return;
      suppressNextClick();
      const action = actions.current[dir];
      if (armed && action) {
        set(0, true);
        if (!getState().prefs.swipeLearned) updatePrefs({ swipeLearned: true });
        setTimeout(() => action.run(), 120);
      } else {
        set(0, true);
      }
      armed = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  return html`<div class="swipe" ref=${box}>
    ${right && html`<div class=${`swipe-bg is-right tone-${right.tone || 'ok'}`} aria-hidden="true"><${Icon} name=${right.icon} size=${20} /><span>${right.label}</span></div>`}
    ${left && html`<div class=${`swipe-bg is-left tone-${left.tone || 'danger'}`} aria-hidden="true"><span>${left.label}</span><${Icon} name=${left.icon} size=${20} /></div>`}
    <div class="swipe-fg" ref=${fg}>${children}</div>
  </div>`;
}

// Dica que aparece até a pessoa usar o gesto pela primeira vez.
export function SwipeHint({ text }) {
  if (getState().prefs.swipeLearned) return null;
  return html`<p class="swipe-hint"><${Icon} name="arrow-left" size=${14} /><${Icon} name="arrow-right" size=${14} />${text}</p>`;
}
