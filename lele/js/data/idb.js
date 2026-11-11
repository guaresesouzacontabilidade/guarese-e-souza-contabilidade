// Armazenamento local: IndexedDB (mais robusto), com localStorage como reserva.

const DB_NAME = 'app-da-lele';
const STORE = 'kv';
const LS_PREFIX = 'lele:';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  }).catch((err) => {
    console.warn('[lele] usando localStorage:', err?.message);
    return null;
  });
  return dbPromise;
}

export async function readAll(keys) {
  const db = await openDB();
  const out = {};
  if (db) {
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const store = t.objectStore(STORE);
      for (const key of keys) {
        const req = store.get(key);
        req.onsuccess = () => {
          out[key] = req.result;
        };
      }
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  }
  for (const key of keys) {
    if (out[key] === undefined) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (raw) out[key] = JSON.parse(raw);
      } catch {
        /* sem localStorage */
      }
    }
  }
  return out;
}

export async function writeMany(entries) {
  const db = await openDB();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        for (const [key, value] of entries) store.put(value, key);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      return true;
    } catch (err) {
      console.warn('[lele] falha no IndexedDB, tentando localStorage', err);
    }
  }
  try {
    for (const [key, value] of entries) localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[lele] não foi possível salvar', err);
    return false;
  }
}

export async function clearAll() {
  const db = await openDB();
  if (db) {
    await new Promise((resolve) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).clear();
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS_PREFIX) && k !== `${LS_PREFIX}prefs`)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// Pede ao navegador para não apagar os dados quando faltar espaço.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* opcional */
  }
}

// Preferências do aparelho (tema, sons): lidas antes da tela aparecer.
export function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(`${LS_PREFIX}prefs`) || '{}');
  } catch {
    return {};
  }
}

export function writePrefs(prefs) {
  try {
    localStorage.setItem(`${LS_PREFIX}prefs`, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
