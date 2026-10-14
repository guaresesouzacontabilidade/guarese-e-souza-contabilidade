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

// Cada painel aberto ganha uma entrada no histórico, para o "voltar" do Android/navegador
// fechar o painel em vez de sair da tela. history.back() é assíncrono, então novas entradas
// esperam os "voltar" pendentes terminarem antes de serem criadas.
let expectedPops = 0;
let queuedPushes = [];
let pendingNav = null;

let backBatch = 0;

function pushEntry(layer) {
  if (expectedPops > 0 || backBatch > 0) {
    queuedPushes.push(layer.id);
    return;
  }
  history.pushState({ ...(history.state || {}), layer: layer.id }, '');
  layer.pushed = true;
}

// Junta vários "voltar" pedidos no mesmo instante num único history.go (alguns navegadores os unem).
function goBack(n) {
  if (n <= 0) return;
  if (backBatch === 0) {
    queueMicrotask(() => {
      const total = backBatch;
      backBatch = 0;
      expectedPops++;
      history.go(-total);
    });
  }
  backBatch += n;
}

function addLayer(layer) {
  layers = [...layers, layer];
  pushEntry(layer);
  emitLayers();
}

// Abre um painel. `render(close)` devolve o conteúdo.
export function openSheet(render, { title = '', size = 'md', onClose } = {}) {
  const id = ++seq;
  addLayer({ id, type: 'sheet', render, title, size, onClose, returnFocus: document.activeElement });
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

function finish(layer) {
  layer.onClose?.();
  if (layer.resolve) layer.resolve(layer.cancelValue);
  try {
    layer.returnFocus?.focus?.({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

function dropTop() {
  const top = layers[layers.length - 1];
  if (!top) return null;
  layers = layers.slice(0, -1);
  queuedPushes = queuedPushes.filter((id) => id !== top.id);
  emitLayers();
  finish(top);
  return top;
}

// Fecha o painel do topo (botão X, fundo, Esc ou ação concluída).
export function closeLayer() {
  const top = dropTop();
  if (top?.pushed) goBack(1);
}

export function closeAllLayers(thenNavigate) {
  let pushed = 0;
  while (layers.length) {
    const top = dropTop();
    if (top.pushed) pushed++;
  }
  if (pushed) {
    pendingNav = thenNavigate || null;
    goBack(pushed);
  } else if (thenNavigate) {
    navigate(thenNavigate);
  }
}

// Fecha painéis abertos e vai para outra tela.
export function goTo(path) {
  closeAllLayers(path);
}

addEventListener('popstate', () => {
  if (expectedPops > 0) {
    // Fim de um "voltar" que nós mesmos pedimos.
    expectedPops--;
    if (expectedPops === 0) {
      const ids = queuedPushes;
      queuedPushes = [];
      for (const id of ids) {
        const layer = layers.find((l) => l.id === id);
        if (layer) pushEntry(layer);
      }
      if (pendingNav) {
        const target = pendingNav;
        pendingNav = null;
        navigate(target);
      }
    }
    return;
  }
  // "Voltar" do usuário: fecha o painel do topo.
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
    addLayer({ id, type: 'dialog', title, message, options, icon, danger, resolve, cancelValue, returnFocus: document.activeElement });
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
