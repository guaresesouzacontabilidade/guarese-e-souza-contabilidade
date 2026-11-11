// Estado do app: baralhos, notas, cartões, imagens, registros diários e ajustes.
// Tudo fica salvo no aparelho; cada alteração é marcada para a sincronização enviar.
import { readAll, writeMany, clearAll, readPrefs, writePrefs } from './idb.js';

export const COLLECTIONS = ['decks', 'notes', 'cards', 'media', 'logs', 'settings'];
const KEYS = [...COLLECTIONS, 'meta'];

export const DEFAULT_SETTINGS = Object.freeze({
  id: 'main',
  name: 'Lelé',
  newPerDay: 20,
  dailyGoal: 0,
});

let state = emptyState();
const listeners = new Set();
const localListeners = new Set();
const unsaved = new Set();
let saveTimer = null;
let lastStamp = 0;

function emptyState() {
  const s = { meta: { dirty: {}, lastPulledAt: null, syncCode: null, deviceId: null, onboarded: false, packs: {} } };
  for (const c of COLLECTIONS) s[c] = {};
  return s;
}

const randomId = (n = 10) => {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
};
export const newId = (prefix = '') => `${prefix}${Date.now().toString(36)}${randomId(6)}`;

export async function init() {
  const saved = await readAll(KEYS);
  state = emptyState();
  for (const c of COLLECTIONS) if (saved[c] && typeof saved[c] === 'object') state[c] = saved[c];
  state.meta = { ...state.meta, ...(saved.meta || {}) };
  if (!state.meta.deviceId) {
    state.meta.deviceId = randomId(8);
    markUnsaved('meta');
  }
  emit();
  return state;
}

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Avisado só quando a mudança veio deste aparelho (para agendar o envio).
export function onLocalChange(fn) {
  localListeners.add(fn);
  return () => localListeners.delete(fn);
}

let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    for (const fn of listeners) fn(state);
  });
}

function markUnsaved(key) {
  unsaved.add(key);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350);
}

export async function flush() {
  clearTimeout(saveTimer);
  if (!unsaved.size) return;
  const keys = [...unsaved];
  unsaved.clear();
  await writeMany(keys.map((k) => [k, state[k]]));
}

// Hora sempre crescente: duas alterações seguidas nunca têm o mesmo carimbo.
export function stamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/**
 * Grava vários registros de uma vez: [[colecao, registro], ...].
 * Cada registro recebe updatedAt novo e fica marcado para sincronizar.
 */
export function putMany(entries) {
  if (!entries.length) return;
  const touched = new Set();
  const dirty = { ...state.meta.dirty };
  for (const [col, rec] of entries) {
    if (!COLLECTIONS.includes(col)) throw new Error(`coleção desconhecida: ${col}`);
    const updatedAt = stamp();
    const next = { ...rec, updatedAt };
    if (!touched.has(col)) {
      state = { ...state, [col]: { ...state[col] } };
      touched.add(col);
    }
    state[col][rec.id] = next;
    dirty[`${col}:${rec.id}`] = updatedAt;
  }
  state = { ...state, meta: { ...state.meta, dirty } };
  for (const col of touched) markUnsaved(col);
  markUnsaved('meta');
  emit();
  for (const fn of localListeners) fn();
}

export const put = (col, rec) => putMany([[col, rec]]);

// Apagar deixa uma "lápide" para os outros aparelhos também apagarem.
export function tombstones(col, ids) {
  return ids.map((id) => [col, { id, deleted: true }]);
}

export const remove = (col, id) => putMany(tombstones(col, [id]));

export function get(col, id) {
  const r = state[col][id];
  return r && !r.deleted ? r : null;
}

// Lista sem os apagados (com cache enquanto a coleção não muda).
const listCache = new Map();
export function list(col) {
  const src = state[col];
  const hit = listCache.get(col);
  if (hit && hit.src === src) return hit.out;
  const out = Object.values(src).filter((r) => r && !r.deleted);
  listCache.set(col, { src, out });
  return out;
}

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(state.settings.main || {}) };
}

export function updateSettings(patch) {
  put('settings', { ...settings(), ...patch, id: 'main' });
}

// Dados só deste aparelho (não sincronizam).
export function updateMeta(patch) {
  state = { ...state, meta: { ...state.meta, ...patch } };
  markUnsaved('meta');
  emit();
}

// ---------- Sincronização ----------

/** Registros alterados aqui e ainda não enviados: [{ c, i, d, x, u }] */
export function pendingRows(limitBytes = 700_000) {
  const rows = [];
  let size = 0;
  for (const key of Object.keys(state.meta.dirty)) {
    const sep = key.indexOf(':');
    const col = key.slice(0, sep);
    const id = key.slice(sep + 1);
    const rec = state[col]?.[id];
    if (!rec) continue;
    const { id: _id, updatedAt, deleted, ...data } = rec;
    const row = { c: col, i: id, d: deleted ? {} : data, x: Boolean(deleted), u: updatedAt || 1 };
    const bytes = JSON.stringify(row).length;
    if (rows.length && size + bytes > limitBytes) break;
    rows.push(row);
    size += bytes;
    if (rows.length >= 400) break;
  }
  return rows;
}

export const pendingCount = () => Object.keys(state.meta.dirty).length;

// Depois de enviar: limpa a marca só se o registro não mudou de novo no meio do caminho.
export function clearDirty(rows) {
  const dirty = { ...state.meta.dirty };
  for (const r of rows) {
    const key = `${r.c}:${r.i}`;
    if (dirty[key] !== undefined && dirty[key] <= r.u) delete dirty[key];
  }
  state = { ...state, meta: { ...state.meta, dirty } };
  markUnsaved('meta');
  emit();
}

// Aplica o que veio da nuvem. Vale a versão mais recente de cada registro.
export function applyRemote(rows) {
  if (!rows?.length) return 0;
  const touched = new Set();
  let applied = 0;
  for (const r of rows) {
    const col = r.collection;
    if (!COLLECTIONS.includes(col)) continue;
    const local = state[col][r.id];
    const remoteAt = Number(r.client_updated_at) || 0;
    if (local && (local.updatedAt || 0) >= remoteAt) continue;
    if (!touched.has(col)) {
      state = { ...state, [col]: { ...state[col] } };
      touched.add(col);
    }
    state[col][r.id] = r.deleted ? { id: r.id, deleted: true, updatedAt: remoteAt } : { ...r.data, id: r.id, updatedAt: remoteAt };
    lastStamp = Math.max(lastStamp, remoteAt);
    applied += 1;
  }
  for (const col of touched) markUnsaved(col);
  if (touched.size) emit();
  return applied;
}

// Marca tudo o que existe no aparelho para ser enviado (ao ligar a sincronização).
export function markAllDirty() {
  const dirty = { ...state.meta.dirty };
  for (const col of COLLECTIONS) {
    for (const rec of Object.values(state[col])) dirty[`${col}:${rec.id}`] = rec.updatedAt || stamp();
  }
  updateMeta({ dirty });
}

// Apaga os dados deste aparelho (mantém o identificador do aparelho e as preferências).
export async function resetLocal(metaPatch = {}) {
  const deviceId = state.meta.deviceId;
  state = emptyState();
  state.meta = { ...state.meta, deviceId, ...metaPatch };
  listCache.clear();
  await clearAll();
  for (const k of KEYS) unsaved.add(k);
  await flush();
  emit();
}

// Substitui tudo por um backup (arquivo .json exportado pelo app).
export async function replaceAll(data, metaPatch = {}) {
  const deviceId = state.meta.deviceId;
  const next = emptyState();
  for (const c of COLLECTIONS) next[c] = data[c] && typeof data[c] === 'object' ? data[c] : {};
  next.meta = { ...next.meta, deviceId, onboarded: true, ...metaPatch };
  state = next;
  listCache.clear();
  for (const k of KEYS) unsaved.add(k);
  await flush();
  emit();
}

// ---------- Preferências do aparelho ----------

let prefs = { theme: 'auto', sound: true, ...readPrefs() };
const prefListeners = new Set();
export const getPrefs = () => prefs;
export function updatePrefs(patch) {
  prefs = { ...prefs, ...patch };
  writePrefs(prefs);
  for (const fn of prefListeners) fn(prefs);
  emit();
}
export function subscribePrefs(fn) {
  prefListeners.add(fn);
  return () => prefListeners.delete(fn);
}
