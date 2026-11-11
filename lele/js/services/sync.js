// Sincronização entre aparelhos pelo "código de sincronização" (sem login).
// Os dados ficam sempre no aparelho; com o código, cada mudança vai para a nuvem
// e as dos outros aparelhos chegam aqui. Se o mesmo item mudar em dois lugares, vale o mais recente.
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import * as store from '../data/store.js';

export const cloudEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

// Aceita o código com ou sem "LELE-", traços, espaços e em minúsculas.
export function normalizeCode(input) {
  let raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length === 24 && raw.startsWith('LELE')) raw = raw.slice(4);
  return /^[A-HJ-NP-Z2-9]{20}$/.test(raw) ? raw : null;
}

export const formatCode = (code) => (code ? `LELE-${code.match(/.{1,5}/g).join('-')}` : '');

// ---------- Estado observável ----------

let status = { state: 'off', lastSyncAt: null, error: null };
const listeners = new Set();
export const getStatus = () => status;
export function subscribeSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

export function friendlyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!navigator.onLine || msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) {
    return 'Sem internet agora. Tudo continua salvo no aparelho e sincroniza quando a conexão voltar.';
  }
  if (msg.includes('inválido')) return 'Esse código não parece certo. Confira as letras e os números.';
  return 'Não consegui sincronizar agora. Vou tentar de novo sozinho.';
}

// ---------- Chamadas à nuvem ----------

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.message || '';
    } catch {
      /* sem corpo */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function pullSince(code, since) {
  const rows = [];
  let cursor = since;
  for (;;) {
    const page = await rpc('lele_pull', { p_code: code, p_since: cursor, p_limit: 500 });
    rows.push(...page);
    if (page.length < 500) break;
    cursor = page[page.length - 1].server_updated_at;
  }
  return rows;
}

// ---------- Ligar e desligar ----------

let started = false;

export function initSync() {
  if (!cloudEnabled() || started) return;
  started = true;
  store.onLocalChange(() => scheduleSync(2500));
  addEventListener('online', () => scheduleSync(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300);
    else if (store.pendingCount()) syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  }, 60000);
  if (store.getState().meta.syncCode) {
    setStatus({ state: 'idle' });
    scheduleSync(200);
  }
}

// Primeiro aparelho: cria um código novo e envia tudo o que já existe.
export async function createVault() {
  if (!cloudEnabled()) return null;
  const code = generateCode();
  store.updateMeta({ syncCode: code, lastPulledAt: null });
  store.markAllDirty();
  setStatus({ state: 'idle' });
  syncNow();
  return code;
}

/**
 * Outro aparelho: entra com um código existente. Confere se o código tem dados
 * antes de apagar o que está neste aparelho.
 */
export async function joinVault(input) {
  const code = normalizeCode(input);
  if (!code) throw new Error('Esse código não parece certo. Ele tem 20 letras e números (LELE-XXXXX-XXXXX-XXXXX-XXXXX).');
  setStatus({ state: 'syncing', error: null });
  let rows;
  try {
    rows = await pullSince(code, null);
  } catch (err) {
    setStatus({ state: 'error', error: friendlyError(err) });
    throw new Error(friendlyError(err));
  }
  if (!rows.length) {
    setStatus({ state: store.getState().meta.syncCode ? 'idle' : 'off' });
    throw new Error('Não encontrei dados com esse código. Confira se digitou igual ao do outro aparelho.');
  }
  await store.resetLocal({ syncCode: code, onboarded: true, lastPulledAt: null });
  store.applyRemote(rows);
  const maxTs = rows.reduce((m, r) => (!m || r.server_updated_at > m ? r.server_updated_at : m), null);
  store.updateMeta({ lastPulledAt: maxTs });
  await store.flush();
  setStatus({ state: 'ok', lastSyncAt: Date.now(), error: null });
  return rows.length;
}

// Desliga neste aparelho (os dados continuam aqui e na nuvem).
export function disconnect() {
  clearTimeout(timer);
  store.updateMeta({ syncCode: null, lastPulledAt: null, dirty: {} });
  setStatus({ state: 'off', lastSyncAt: null, error: null });
}

// ---------- Ciclo de sincronização ----------

let timer = null;
let current = null;
let again = false;

export function scheduleSync(delay = 2000) {
  if (!cloudEnabled() || !store.getState().meta.syncCode) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export function syncNow() {
  if (current) {
    again = true;
    return current;
  }
  current = runSync().finally(() => {
    current = null;
    if (again) {
      again = false;
      scheduleSync(800);
    }
  });
  return current;
}

async function runSync() {
  const code = store.getState().meta.syncCode;
  if (!cloudEnabled() || !code) return;
  setStatus({ state: 'syncing', error: null });
  try {
    // Envia em lotes até não sobrar nada pendente.
    for (let guard = 0; guard < 200; guard++) {
      const rows = store.pendingRows();
      if (!rows.length) break;
      await rpc('lele_push', { p_code: code, p_rows: rows });
      if (store.getState().meta.syncCode !== code) return;
      store.clearDirty(rows);
    }
    const cursor = store.getState().meta.lastPulledAt;
    // Pequena sobreposição para não perder gravações simultâneas; aplicar de novo é inofensivo.
    const since = cursor ? new Date(new Date(cursor).getTime() - 5000).toISOString() : null;
    const rows = await pullSince(code, since);
    if (store.getState().meta.syncCode !== code) return;
    store.applyRemote(rows);
    let maxTs = cursor;
    for (const r of rows) if (!maxTs || new Date(r.server_updated_at) > new Date(maxTs)) maxTs = r.server_updated_at;
    store.updateMeta({ lastPulledAt: maxTs });
    setStatus({ state: 'ok', lastSyncAt: Date.now(), error: null });
  } catch (err) {
    console.warn('[lele] sincronização falhou', err);
    setStatus({ state: navigator.onLine ? 'error' : 'offline', error: friendlyError(err) });
  }
}
