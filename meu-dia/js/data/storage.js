// Armazenamento local: IndexedDB (mais robusto), com localStorage como reserva.

const DB_NAME = 'meu-dia';
const STORE = 'kv';
const LS_PREFIX = 'meu-dia:';

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
    console.warn('[meu-dia] usando localStorage:', err?.message);
    return null;
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
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
  // Reserva (ou migração de dados salvos sem IndexedDB).
  for (const key of keys) {
    if (out[key] === undefined) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key);
        if (raw) out[key] = JSON.parse(raw);
      } catch {
        /* sem acesso ao localStorage */
      }
    }
  }
  return out;
}

export async function write(key, value) {
  const db = await openDB();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => s.put(value, key));
      return true;
    } catch (err) {
      console.warn('[meu-dia] falha no IndexedDB, tentando localStorage', err);
    }
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[meu-dia] não foi possível salvar', err);
    return false;
  }
}

export async function clearAll() {
  const db = await openDB();
  if (db) await tx(db, 'readwrite', (s) => s.clear());
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// Pede ao navegador para não apagar os dados quando faltar espaço.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* opcional */
  }
}

// Preferências do aparelho que precisam ser lidas antes da tela aparecer (tema).
export function readPrefsSync() {
  try {
    return JSON.parse(localStorage.getItem(`${LS_PREFIX}prefs-mirror`) || '{}');
  } catch {
    return {};
  }
}

export function mirrorPrefs(prefs) {
  try {
    localStorage.setItem(`${LS_PREFIX}prefs-mirror`, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
