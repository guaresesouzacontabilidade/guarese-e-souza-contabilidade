// Efeitos de toque e de movimento: onda de luz, troca de tela deslizando, confete e sons.
// Tudo é desligado quando o celular pede "reduzir movimento" ou em Ajustes › Aparência.
import { getState } from '../data/store.js';
import { feedback } from '../services/feedback.js';

const PRESSABLE = 'button, a[href], [role="button"], summary';
// Estes têm som próprio (troca de tela, concluir tarefa, ligar/desligar).
const OWN_SOUND = '.tab:not(.tab-add), .side-link, .brand, .check, .toggle-row, [role="switch"]';
const ORDER = ['/', '/agenda', '/financas', '/contas', '/relatorios', '/assistente', '/ajustes'];
const root = document.documentElement;

let lastPoint = null;
let started = false;
let swallowClick = false;

// Depois de arrastar uma linha, o "clique" que o navegador dispara ao soltar não deve abrir nada.
export function suppressNextClick() {
  swallowClick = true;
  setTimeout(() => (swallowClick = false), 400);
}

export const motionReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || getState().prefs.motion === false;

export function applyMotionPref() {
  root.dataset.motion = motionReduced() ? 'reduced' : 'full';
}

// ---------- Onda de luz ----------

function spawnRipple(el, x, y) {
  const host = el.matches('.tab') ? el.querySelector('.tab-ico, .fab') || el : el;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const size = Math.hypot(rect.width, rect.height) * 2;
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
    host.dataset.fxPos = '1';
  }
  const layer = document.createElement('span');
  layer.className = 'ripple-host';
  layer.setAttribute('aria-hidden', 'true');
  const wave = document.createElement('span');
  wave.className = 'ripple';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${x - rect.left - size / 2}px;top:${y - rect.top - size / 2}px`;
  layer.appendChild(wave);
  host.appendChild(layer);
  const cleanup = () => {
    layer.remove();
    if (host.dataset.fxPos && !host.querySelector(':scope > .ripple-host')) {
      host.style.position = '';
      delete host.dataset.fxPos;
    }
  };
  wave.addEventListener('animationend', cleanup);
  setTimeout(cleanup, 1200);
  return wave;
}

// Superfícies grandes (linhas de lista, ajustes) "afundam" de leve e voltam com mola.
const SURFACE = '.item, .item-main, .settings-row, .flow-item, .limit, .card-alert, .forecast-head, .import-main, .month-cell, .week-day';

function press(el) {
  const surface = el.closest(SURFACE);
  if (!surface || !surface.animate) return () => {};
  const down = surface.animate([{ scale: '1' }, { scale: '0.982' }], { duration: 120, easing: 'ease-out', fill: 'forwards' });
  return () => {
    down.cancel();
    surface.animate([{ scale: '0.982' }, { scale: '1' }], { duration: 320, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' });
  };
}

// No toque, espera um instante para saber se a pessoa está rolando a tela (aí não mostra nada).
function onPointerDown(e) {
  lastPoint = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.target.closest?.(PRESSABLE);
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || motionReduced()) return;
  let wave = null;
  let release = null;
  let begun = false;
  const start = () => {
    begun = true;
    wave = spawnRipple(el, e.clientX, e.clientY);
    release = press(el);
  };
  const timer = e.pointerType === 'touch' ? setTimeout(start, 60) : (start(), null);
  const end = (ev) => {
    clearTimeout(timer);
    // Toque rápido (antes dos 60 ms) também ganha a onda; rolar a tela (pointercancel) não.
    if (!begun && ev.type === 'pointerup') start();
    if (ev.type === 'pointercancel') wave?.classList.add('is-cancel');
    release?.();
    removeEventListener('pointerup', end, true);
    removeEventListener('pointercancel', end, true);
  };
  addEventListener('pointerup', end, true);
  addEventListener('pointercancel', end, true);
}

// Som do toque: só em toques de verdade (o "click"), nunca ao começar a rolar a tela.
function onClick(e) {
  if (swallowClick) {
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  const el = e.target.closest?.(PRESSABLE);
  if (!el || el.disabled || el.closest(OWN_SOUND)) return;
  feedback('tap');
}

// Depois que o ajuste já foi aplicado: ao ligar "Sons", toca; ao desligar, fica em silêncio.
function onChange(e) {
  const t = e.target;
  if (t?.matches?.('input[type="checkbox"]')) setTimeout(() => feedback(t.checked ? 'on' : 'off'), 0);
}

export function startFx() {
  if (started) return;
  started = true;
  applyMotionPref();
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyMotionPref);
  if ('startViewTransition' in document) root.classList.add('vt');
  addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  addEventListener('click', onClick, true);
  addEventListener('change', onChange, true);
}

// ---------- Troca de tela ----------

// Desliza para a direita ou para a esquerda conforme a ordem das abas; o destaque da aba "viaja".
export function navTransition(fromPath, toPath, update) {
  const a = ORDER.indexOf(fromPath);
  const b = ORDER.indexOf(toPath);
  root.dataset.nav = b >= a ? 'forward' : 'back';
  feedback('nav');
  if (motionReduced() || !document.startViewTransition || document.visibilityState !== 'visible') {
    update();
    return;
  }
  try {
    // Marca a troca em andamento (durante ela a página não recebe toques).
    root.dataset.navigating = '';
    const t = document.startViewTransition(async () => {
      update();
      await new Promise((r) => setTimeout(r, 0));
      scrollTo({ top: 0 });
    });
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    t.finished.catch(() => {}).finally(() => delete root.dataset.navigating);
  } catch {
    delete root.dataset.navigating;
    update();
  }
}

// ---------- Confete ----------

const COLORS = ['var(--accent)', 'var(--accent-2)', 'var(--positive)', 'var(--warning)', 'var(--accent-strong)'];

export function celebrate(point) {
  if (motionReduced() || !document.body.animate) return;
  // Sai do último toque (ex.: o botão "Pagar"); se não houve toque recente, do meio da tela.
  const recent = lastPoint && performance.now() - lastPoint.t < 2500 ? lastPoint : null;
  const p = point || recent || { x: innerWidth / 2, y: innerHeight / 2 };
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('i');
  ring.className = 'fx-ring';
  ring.style.left = `${p.x}px`;
  ring.style.top = `${p.y}px`;
  layer.appendChild(ring);
  for (let i = 0; i < 22; i++) {
    const bit = document.createElement('i');
    bit.className = `fx-bit ${i % 3 === 0 ? 'is-bar' : ''}`;
    bit.style.left = `${p.x}px`;
    bit.style.top = `${p.y}px`;
    bit.style.background = COLORS[i % COLORS.length];
    layer.appendChild(bit);
    const angle = (i / 22) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 46 + Math.random() * 64;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 26;
    const spin = (Math.random() - 0.5) * 540;
    // Explode rápido, depois cai devagar e some no fim.
    bit.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1, easing: 'cubic-bezier(0.1, 0.9, 0.3, 1)' },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin}deg) scale(1)`, opacity: 1, offset: 0.4, easing: 'cubic-bezier(0.4, 0, 0.8, 0.6)' },
        { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 34}px)) rotate(${spin * 1.4}deg) scale(0.95)`, opacity: 1, offset: 0.75 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 52}px)) rotate(${spin * 1.6}deg) scale(0.7)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 350, fill: 'forwards' },
    );
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}
