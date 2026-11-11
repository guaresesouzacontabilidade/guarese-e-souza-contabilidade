// Ligação com o Notion (pela função lele-notion no Supabase). A conexão fica presa ao
// código de sincronização: vale para todos os aparelhos da Lelé.
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import * as store from '../data/store.js';
import { cloudEnabled, createVault } from './sync.js';

export const notionAvailable = () => cloudEnabled();

function friendly(err, status) {
  if (!navigator.onLine || /failed to fetch|load failed|network/i.test(String(err?.message || err))) {
    return 'Sem internet agora. Para falar com o Notion, o app precisa de conexão.';
  }
  if (status === 404) return 'A ligação com o Notion ainda não foi publicada.';
  return null;
}

export async function callNotion(action, body = {}) {
  let code = store.getState().meta.syncCode;
  if (!code && action !== 'config') code = await createVault();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/lele-notion`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, code, ...body }),
    });
  } catch (err) {
    throw new Error(friendly(err) || 'Não consegui falar com o Notion agora.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(friendly(null, res.status) || data.message || 'Não consegui falar com o Notion agora.');
    e.status = res.status;
    throw e;
  }
  return data;
}

// Abre a tela de autorização do Notion numa janela nova (no iPhone instalado, abre por cima do app).
export async function startNotionConnect() {
  const base = location.href.split('#')[0].replace(/[^/]*$/, '');
  const { url } = await callNotion('start', { returnUrl: `${base}notion-ok.html` });
  const w = window.open(url, '_blank');
  if (!w) location.href = url;
}

/**
 * Lê as páginas escolhidas. Bases de dados viram a lista das páginas delas.
 * items: [{ id, type: 'page'|'database', title }]
 */
export async function loadNotionPages(items, onProgress = () => {}) {
  const pages = [];
  for (const it of items) {
    if (it.type === 'database') {
      onProgress({ label: it.title });
      const db = await callNotion('database', { id: it.id });
      for (const p of db.pages) pages.push({ ...p, type: 'page', group: db.title });
    } else pages.push(it);
  }
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress({ label: pages[i].title, index: i + 1, total: pages.length });
    const page = await callNotion('page', { id: pages[i].id });
    out.push({ ...page, group: pages[i].group || null });
  }
  return out;
}
