// Estado da interface: rotas, painéis (sheets), confirmações e avisos.
import { useEffect, useState } from '../vendor/preact.js';
import * as store from '../data/store.js';
import { getAuth, getSync, subscribeCloud } from '../services/cloud.js';

// ---------- Rotas (hash) ----------

export function parseRoute(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  if (/access_token=|error_description=|type=recovery/.test(raw)) return { path: '/', params: {} };
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function navigate(path) {
  if (location.hash !== `#${path}`) location.hash = path;
}

export function useRoute() {
  const [route, setRoute] = useState(parseRoute());
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---------- Ligação com os dados ----------

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
  return store.getState();
}

export function useCloud() {
  const [, force] = useState(0);
  useEffect(() => subscribeCloud(() => force((n) => n + 1)), []);
  return { auth: getAuth(), sync: getSync() };
}

// Atualiza a cada minuto (para "agora", saudações, compromissos que passaram).
export function useNow(interval = 60000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

// ---------- Painéis e diálogos ----------

let layers = [];
let seq = 0;
const layerListeners = new Set();
const emitLayers = () => layerListeners.forEach((fn) => fn(layers));

export function useLayers() {
  const [list, setList] = useState(layers);
  useEffect(() => {
    layerListeners.add(setList);
    return () => layerListeners.delete(setList);
  }, []);
  return list;
}

// Abre um painel. `render(close)` devolve o conteúdo.
export function openSheet(render, { title = '', size = 'md', onClose } = {}) {
  const id = ++seq;
  const returnFocus = document.activeElement;
  layers = [...layers, { id, type: 'sheet', render, title, size, onClose, returnFocus }];
  history.pushState({ ...(history.state || {}), layer: id }, '');
  emitLayers();
  return id;
}

// Troca o conteúdo do painel do topo (ex.: menu Adicionar → formulário).
export function replaceSheet(render, { title = '', size = 'md' } = {}) {
  if (!layers.length) return openSheet(render, { title, size });
  const top = layers[layers.length - 1];
  layers = [...layers.slice(0, -1), { ...top, render, title, size, key: ++seq }];
  emitLayers();
  return top.id;
}

function dropTop() {
  const top = layers[layers.length - 1];
  if (!top) return;
  layers = layers.slice(0, -1);
  emitLayers();
  top.onClose?.();
  if (top.resolve) top.resolve(top.cancelValue);
  try {
    top.returnFocus?.focus?.({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

export function closeLayer() {
  if (!layers.length) return;
  if (history.state?.layer === layers[layers.length - 1].id) history.back();
  else dropTop();
}

export function closeAllLayers(thenNavigate) {
  const n = layers.length;
  if (!n) {
    if (thenNavigate) navigate(thenNavigate);
    return;
  }
  const ownsHistory = history.state?.layer === layers[n - 1].id;
  while (layers.length) dropTop();
  if (ownsHistory) {
    // Volta as entradas de histórico criadas pelos painéis (um único popstate).
    ignorePops = 1;
    pendingNav = thenNavigate || null;
    history.go(-n);
  } else if (thenNavigate) {
    navigate(thenNavigate);
  }
}

// Fecha painéis abertos e vai para outra tela.
export function goTo(path) {
  closeAllLayers(path);
}

let ignorePops = 0;
let pendingNav = null;
addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    if (pendingNav) {
      const target = pendingNav;
      pendingNav = null;
      navigate(target);
    }
    return;
  }
  if (layers.length) dropTop();
});

// Confirmação com promessa: `if (await confirm({...}))`.
export function confirm({ title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, icon }) {
  return choose({
    title,
    message,
    icon: icon || (danger ? 'trash-2' : 'circle-help'),
    danger,
    options: [
      { value: true, label: confirmLabel, variant: danger ? 'danger' : 'primary' },
      { value: false, label: cancelLabel, variant: 'secondary' },
    ],
    cancelValue: false,
  });
}

// Pergunta com várias opções; devolve o `value` escolhido (ou `cancelValue`).
export function choose({ title, message = '', options, icon = 'circle-help', danger = false, cancelValue = null }) {
  return new Promise((resolve) => {
    const id = ++seq;
    const returnFocus = document.activeElement;
    layers = [...layers, { id, type: 'dialog', title, message, options, icon, danger, resolve, cancelValue, returnFocus }];
    history.pushState({ ...(history.state || {}), layer: id }, '');
    emitLayers();
  });
}

// Usado pelo diálogo para responder.
export function answerDialog(id, value) {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;
  layer.cancelValue = value;
  closeLayer();
}

// ---------- Avisos rápidos (toasts) ----------

let toasts = [];
const toastListeners = new Set();
const emitToasts = () => toastListeners.forEach((fn) => fn(toasts));

export function toast(message, { action, tone = 'info', duration = 4500 } = {}) {
  const id = ++seq;
  // Só o aviso mais recente oferece "Desfazer", para não confundir.
  const keep = action ? toasts.filter((t) => !t.action) : toasts;
  toasts = [...keep.slice(-2), { id, message, action, tone }];
  emitToasts();
  setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

export function useToasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => toastListeners.delete(setList);
  }, []);
  return list;
}
