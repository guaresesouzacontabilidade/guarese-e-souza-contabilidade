// Estado do app: dados do usuário em memória, salvos no aparelho a cada mudança.
import { readAll, write, clearAll, requestPersistence, mirrorPrefs } from './storage.js';
import { uid } from '../core/text.js';
import { planPayment } from '../core/bills.js';
import { isRecurring } from '../core/recurrence.js';
import { BILL_KIND } from '../core/bills.js';
import { learnRule } from '../core/categories.js';

export const COLLECTIONS = ['events', 'transactions', 'wallets', 'bills'];
const KEYS = [...COLLECTIONS, 'settings', 'prefs', 'meta'];

export const DEFAULT_SETTINGS = {
  id: 'settings',
  name: '',
  budget: 0,
  reminderTime: '09:00',
  billRemind: [1, 0],
  eventReminder: 30,
  customCategories: [],
  categoryRules: [],
  categoryBudgets: {},
  updatedAt: 0,
};

const DEFAULT_PREFS = { theme: 'auto', hideValues: false, notifications: false, onboarded: false, installDismissed: false, lock: false, sound: true, vibration: true, motion: true };
const DEFAULT_META = { dirty: {}, lastPulledAt: null, ownerId: null, notified: {}, lastSyncAt: null };

let state = {
  ready: false,
  events: [],
  transactions: [],
  wallets: [],
  bills: [],
  settings: { ...DEFAULT_SETTINGS },
  prefs: { ...DEFAULT_PREFS },
  meta: { ...DEFAULT_META },
};

const listeners = new Set();
let changeHook = null;
const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('meu-dia') : null;

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

// Chamado pela sincronização para saber que algo mudou localmente.
export function onLocalChange(fn) {
  changeHook = fn;
}

// ---------- Persistência ----------

const pending = new Set();
let scheduled = false;

// Grava no mesmo instante (agrupando mudanças da mesma ação), para nada se perder
// se o app for fechado logo depois de salvar.
function persist(keys) {
  keys.forEach((k) => pending.add(k));
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    flush();
  });
}

export async function flush() {
  const keys = [...pending];
  pending.clear();
  if (!keys.length) return;
  await Promise.all(keys.map((k) => write(k, state[k])));
  channel?.postMessage({ type: 'changed', keys });
}

function commit(patch, keys, { synced = true } = {}) {
  state = { ...state, ...patch };
  persist(keys);
  emit();
  if (synced) changeHook?.();
}

export async function load() {
  const data = await readAll(KEYS);
  state = {
    ready: true,
    events: data.events || [],
    transactions: data.transactions || [],
    wallets: data.wallets || [],
    bills: data.bills || [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    prefs: { ...DEFAULT_PREFS, ...(data.prefs || {}) },
    meta: { ...DEFAULT_META, ...(data.meta || {}) },
  };
  pruneTombstones();
  mirrorPrefs(state.prefs);
  emit();
  return state;
}

// Outra aba mudou os dados: recarrega.
channel?.addEventListener('message', async (e) => {
  if (e.data?.type === 'changed') {
    const data = await readAll(e.data.keys);
    const patch = {};
    for (const k of e.data.keys) if (data[k] !== undefined) patch[k] = data[k];
    state = { ...state, ...patch };
    emit();
  }
});

function pruneTombstones() {
  const limit = Date.now() - 30 * 86400000;
  const dirty = state.meta.dirty || {};
  for (const c of COLLECTIONS) {
    state[c] = state[c].filter((r) => !(r.deleted && r.updatedAt < limit && !dirty[`${c}:${r.id}`]));
  }
}

// ---------- CRUD genérico ----------

function withDirty(keys) {
  const dirty = { ...state.meta.dirty };
  for (const k of keys) dirty[k] = true;
  return { ...state.meta, dirty };
}

export function create(collection, data) {
  const now = Date.now();
  const record = { ...data, id: data.id || uid(), createdAt: now, updatedAt: now };
  commit({ [collection]: [...state[collection], record], meta: withDirty([`${collection}:${record.id}`]) }, [collection, 'meta']);
  requestPersistence();
  return record;
}

// Vários registros de uma vez (parcelas, importação): uma só gravação.
export function createMany(collection, list) {
  const now = Date.now();
  const records = list.map((data) => ({ ...data, id: data.id || uid(), createdAt: now, updatedAt: now }));
  if (!records.length) return records;
  commit({ [collection]: [...state[collection], ...records], meta: withDirty(records.map((r) => `${collection}:${r.id}`)) }, [collection, 'meta']);
  requestPersistence();
  return records;
}

export function update(collection, id, patch) {
  const now = Date.now();
  let updated = null;
  const list = state[collection].map((r) => {
    if (r.id !== id) return r;
    updated = { ...r, ...patch, updatedAt: Math.max(now, (r.updatedAt || 0) + 1) };
    return updated;
  });
  if (!updated) return null;
  commit({ [collection]: list, meta: withDirty([`${collection}:${id}`]) }, [collection, 'meta']);
  return updated;
}

export function remove(collection, id) {
  return update(collection, id, { deleted: true });
}

export function restore(collection, id) {
  return update(collection, id, { deleted: false });
}

export const findById = (collection, id) => state[collection].find((r) => r.id === id && !r.deleted) || null;

// ---------- Agenda ----------

export function toggleTask(item, date) {
  if (isRecurring(item)) {
    const done = new Set(item.doneDates || []);
    if (done.has(date)) done.delete(date);
    else done.add(date);
    return update('events', item.id, { doneDates: [...done].sort() });
  }
  return update('events', item.id, { done: !item.done, doneAt: !item.done ? Date.now() : null });
}

export function skipOccurrence(item, date) {
  return update('events', item.id, { skipDates: [...new Set([...(item.skipDates || []), date])] });
}

// ---------- Contas ----------

export function payBill(bill, { date, amount }) {
  const { patch, next } = planPayment(bill, { date, amount }, state.bills);
  const updated = update('bills', bill.id, patch);
  const created = next ? create('bills', next) : null;
  return { bill: updated, next: created };
}

export function unpayBill(bill) {
  const updated = update('bills', bill.id, { status: 'open', paidAt: null, paidAmount: null });
  // Remove a próxima conta criada automaticamente, se ninguém mexeu nela.
  const auto = state.bills.find((b) => !b.deleted && b.generatedFrom === bill.id && b.status !== 'paid' && b.updatedAt === b.createdAt);
  if (auto) remove('bills', auto.id);
  return updated;
}

export function registerBillTransaction(bill, { walletId } = {}) {
  const kind = BILL_KIND[bill.kind] || BILL_KIND.pay;
  const tx = create('transactions', {
    type: kind.tx,
    amount: bill.paidAmount ?? bill.amount,
    description: bill.description,
    date: bill.paidAt || bill.dueDate,
    category: bill.category || null,
    walletId: walletId ?? bill.walletId ?? null,
    notes: '',
    billId: bill.id,
  });
  update('bills', bill.id, { transactionId: tx.id });
  return tx;
}

export function linkBillTransaction(bill, txId) {
  update('transactions', txId, { billId: bill.id });
  return update('bills', bill.id, { transactionId: txId });
}

export function linkedTransaction(bill) {
  if (!bill) return null;
  return (
    state.transactions.find((t) => !t.deleted && t.id === bill.transactionId) ||
    state.transactions.find((t) => !t.deleted && t.billId === bill.id) ||
    null
  );
}

// ---------- Ajustes e preferências ----------

export function updateSettings(patch) {
  const settings = { ...state.settings, ...patch, id: 'settings', updatedAt: Math.max(Date.now(), (state.settings.updatedAt || 0) + 1) };
  commit({ settings, meta: withDirty(['settings:settings']) }, ['settings', 'meta']);
}

// Aprende com a correção de categoria ("UBER" → Transporte). Devolve a regra nova ou alterada.
export function learnCategory({ description, type, category }) {
  const { rules, rule } = learnRule(state.settings.categoryRules || [], { description, type, category, id: uid() });
  if (rule) updateSettings({ categoryRules: rules });
  return rule;
}

export function removeCategoryRule(id) {
  updateSettings({ categoryRules: (state.settings.categoryRules || []).filter((r) => r.id !== id) });
}

export function setCategoryLimit(categoryId, amount) {
  const limits = { ...(state.settings.categoryBudgets || {}) };
  if (amount > 0) limits[categoryId] = amount;
  else delete limits[categoryId];
  updateSettings({ categoryBudgets: limits });
}

export function updatePrefs(patch) {
  const prefs = { ...state.prefs, ...patch };
  mirrorPrefs(prefs);
  commit({ prefs }, ['prefs'], { synced: false });
}

export function updateMeta(patch) {
  commit({ meta: { ...state.meta, ...patch } }, ['meta'], { synced: false });
}

// ---------- Usado pela sincronização ----------

export function allRecords() {
  const out = [];
  for (const c of COLLECTIONS) for (const r of state[c]) out.push({ collection: c, record: r });
  out.push({ collection: 'settings', record: state.settings });
  return out;
}

// Ao juntar os dados do aparelho a uma conta: envia todos os registros, mas deixa os
// ajustes locais como reserva (updatedAt 0), para que os ajustes já salvos na conta prevaleçam.
export function prepareMerge() {
  const keys = [];
  for (const c of COLLECTIONS) for (const r of state[c]) keys.push(`${c}:${r.id}`);
  const dirty = { ...withDirty(keys).dirty };
  delete dirty['settings:settings'];
  commit({ settings: { ...state.settings, updatedAt: 0 }, meta: { ...state.meta, dirty } }, ['settings', 'meta'], { synced: false });
}

export function hasCustomSettings() {
  const s = state.settings;
  return Object.keys(DEFAULT_SETTINGS).some((k) => k !== 'updatedAt' && JSON.stringify(s[k]) !== JSON.stringify(DEFAULT_SETTINGS[k]));
}

// Junta registros vindos da nuvem. Vence a versão alterada por último.
export function applyRemote(rows) {
  if (!rows.length) return 0;
  const lists = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map(state[c].map((r) => [r.id, r]))]));
  let settings = state.settings;
  const dirty = { ...state.meta.dirty };
  let changed = 0;
  for (const row of rows) {
    const remote = { ...row.data, id: row.id, updatedAt: Number(row.client_updated_at), deleted: !!row.deleted };
    const key = `${row.collection}:${row.id}`;
    if (row.collection === 'settings') {
      if (remote.updatedAt > (settings.updatedAt || 0)) {
        settings = { ...DEFAULT_SETTINGS, ...remote, id: 'settings' };
        delete dirty[key];
        changed++;
      }
      continue;
    }
    const map = lists[row.collection];
    if (!map) continue;
    const local = map.get(row.id);
    if (!local || remote.updatedAt > (local.updatedAt || 0)) {
      map.set(row.id, remote);
      delete dirty[key];
      changed++;
    } else if (local.updatedAt > remote.updatedAt) {
      dirty[key] = true;
    }
  }
  if (!changed) return 0;
  const patch = { settings, meta: { ...state.meta, dirty } };
  for (const c of COLLECTIONS) patch[c] = [...lists[c].values()];
  commit(patch, [...COLLECTIONS, 'settings', 'meta'], { synced: false });
  return changed;
}

export function clearDirty(keysWithVersion) {
  const dirty = { ...state.meta.dirty };
  for (const { key, updatedAt } of keysWithVersion) {
    const [collection, id] = key.split(/:(.+)/);
    const current = collection === 'settings' ? state.settings : state[collection]?.find((r) => r.id === id);
    if (!current || (current.updatedAt || 0) <= updatedAt) delete dirty[key];
  }
  commit({ meta: { ...state.meta, dirty } }, ['meta'], { synced: false });
}

// ---------- Backup ----------

export function exportData() {
  const clean = (list) => list.filter((r) => !r.deleted);
  return {
    app: 'meu-dia',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    wallets: clean(state.wallets),
    transactions: clean(state.transactions),
    bills: clean(state.bills),
    events: clean(state.events),
  };
}

export function importData(data) {
  if (!data || data.app !== 'meu-dia') throw new Error('Este arquivo não é um backup do Meu Dia.');
  let count = 0;
  const now = Date.now();
  const patch = {};
  const dirtyKeys = [];
  for (const c of COLLECTIONS) {
    const map = new Map(state[c].map((r) => [r.id, r]));
    for (const r of data[c] || []) {
      if (!r || !r.id) continue;
      const local = map.get(r.id);
      // Também restaura o que foi excluído depois de o backup ser feito.
      if (!local || (r.updatedAt || 0) > (local.updatedAt || 0) || (local.deleted && !r.deleted)) {
        map.set(r.id, { ...r, deleted: false, updatedAt: Math.max(now, (local?.updatedAt || 0) + 1, r.updatedAt || 0) });
        dirtyKeys.push(`${c}:${r.id}`);
        count++;
      }
    }
    patch[c] = [...map.values()];
  }
  if (data.settings && (data.settings.updatedAt || 0) > (state.settings.updatedAt || 0)) {
    patch.settings = { ...DEFAULT_SETTINGS, ...data.settings, id: 'settings', updatedAt: now };
    dirtyKeys.push('settings:settings');
  }
  state = { ...state, ...patch };
  commit({ meta: withDirty(dirtyKeys) }, [...COLLECTIONS, 'settings', 'meta']);
  return count;
}

// Volta tudo a uma cópia (ex.: backup automático de ontem). Mantém as preferências do aparelho.
export async function replaceAllData(data) {
  if (!data || data.app !== 'meu-dia') throw new Error('Cópia inválida.');
  const { ownerId, lastPulledAt } = state.meta;
  await resetLocal({ keepPrefs: true });
  updateMeta({ ownerId, lastPulledAt });
  const count = importData({ ...data, settings: data.settings ? { ...data.settings, updatedAt: (data.settings.updatedAt || 0) + 1 } : undefined });
  updatePrefs({ onboarded: true });
  return count;
}

export function countRecords() {
  return COLLECTIONS.reduce((n, c) => n + state[c].filter((r) => !r.deleted).length, 0);
}

// Apaga tudo deste aparelho (ao sair da conta ou excluir).
export async function resetLocal({ keepPrefs = true } = {}) {
  pending.clear();
  const prefs = keepPrefs ? { ...state.prefs } : { ...DEFAULT_PREFS };
  await clearAll();
  state = {
    ready: true,
    events: [],
    transactions: [],
    wallets: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS },
    prefs,
    meta: { ...DEFAULT_META },
  };
  await Promise.all(KEYS.map((k) => write(k, state[k])));
  mirrorPrefs(prefs);
  channel?.postMessage({ type: 'changed', keys: KEYS });
  emit();
}

export { DEFAULT_PREFS };
