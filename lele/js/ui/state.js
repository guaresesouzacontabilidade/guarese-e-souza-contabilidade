// Estado da interface: rotas, painéis, avisos e confirmações.
import { html, useEffect, useState, useReducer } from '../vendor/preact.js';
import * as store from '../data/store.js';
import { getStatus, subscribeSync } from '../services/sync.js';

// ---------- Dados ----------

export function useStore() {
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => store.subscribe(force), []);
  return store.getState();
}

export function useSync() {
  const [s, set] = useState(getStatus());
  useEffect(() => subscribeSync(set), []);
  return s;
}

// ---------- Rotas (hash) ----------

export function parseRoute(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  return { path: path || '/', parts, params: Object.fromEntries(new URLSearchParams(query)) };
}

let depth = 0; // quantas telas abrimos dentro do app (para o botão voltar)
let ignorePop = false;

export function navigate(path, { replace = false } = {}) {
  if (location.hash === `#${path}`) return;
  if (replace) {
    history.replaceState(null, '', `#${path}`);
    dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    depth += 1;
    location.hash = path;
  }
}

export function back(fallback = '/') {
  if (depth > 0) {
    depth -= 1;
    ignorePop = true;
    history.back();
  } else navigate(fallback, { replace: true });
}

addEventListener('popstate', () => {
  if (ignorePop) ignorePop = false;
  else if (depth > 0) depth -= 1;
});

export function useRoute() {
  const [route, setRoute] = useState(parseRoute());
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute());
      window.scrollTo({ top: 0 });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---------- Camadas: painéis, avisos ----------

let layers = { sheets: [], toasts: [] };
const layerListeners = new Set();
let seq = 0;

function setLayers(next) {
  layers = next;
  for (const fn of layerListeners) fn(layers);
}

export function useLayers() {
  const [l, set] = useState(layers);
  useEffect(() => {
    layerListeners.add(set);
    return () => layerListeners.delete(set);
  }, []);
  return l;
}

/**
 * Abre um painel. `render` é um componente que recebe { close } e devolve o conteúdo
 * (normalmente <SheetParts>). Retorna a função de fechar.
 */
export function openSheet(render, { onClose, label = '' } = {}) {
  const id = ++seq;
  const close = (result) => {
    const sheet = layers.sheets.find((s) => s.id === id);
    if (!sheet || sheet.closing) return;
    setLayers({ ...layers, sheets: layers.sheets.map((s) => (s.id === id ? { ...s, closing: true } : s)) });
    setTimeout(() => {
      setLayers({ ...layers, sheets: layers.sheets.filter((s) => s.id !== id) });
      onClose?.(result);
    }, 220);
  };
  setLayers({ ...layers, sheets: [...layers.sheets, { id, render, label, close, closing: false }] });
  return close;
}

export function closeTopSheet() {
  const top = [...layers.sheets].reverse().find((s) => !s.closing);
  if (top) {
    top.close();
    return true;
  }
  return false;
}

export const hasOpenSheet = () => layers.sheets.some((s) => !s.closing);

export function toast(text, { action, duration = 3800 } = {}) {
  const id = ++seq;
  setLayers({ ...layers, toasts: [...layers.toasts.slice(-2), { id, text, action }] });
  setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id) {
  setLayers({ ...layers, toasts: layers.toasts.filter((t) => t.id !== id) });
}

// Confirmação em painel. Resolve true/false.
export function confirm({ title, text, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(
      ({ close }) => html`
        <${SheetParts}
          title=${title}
          close=${close}
          foot=${html`
            <button class="btn btn--secondary" onClick=${() => close()}>${cancelLabel}</button>
            <button
              class=${`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
              onClick=${() => {
                answered = true;
                close();
              }}
            >
              ${confirmLabel}
            </button>
          `}
        >
          <p class="confirm__text">${text}</p>
        <//>
      `,
      { onClose: () => resolve(answered) },
    );
  });
}

// Cabeçalho, corpo e rodapé de um painel.
export function SheetParts({ title, close, children, foot, headExtra }) {
  return html`
    <div class="sheet__grip" aria-hidden="true"></div>
    <div class="sheet__head">
      <h2 class="sheet__title">${title}</h2>
      ${headExtra}
      <button class="icon-btn" aria-label="Fechar" onClick=${() => close()}>
        <svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
    </div>
    <div class="sheet__body">${children}</div>
    ${foot && html`<div class="sheet__foot">${foot}</div>`}
  `;
}
